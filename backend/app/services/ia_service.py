"""
Serviço de IA usando Anthropic Claude API (async).
REGRA: A IA NUNCA inventa dados. Sempre usa os dados existentes no banco.
"""
import json
import re
from datetime import date, timedelta
import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from app.config import settings
from app.models.professor import Professor
from app.models.evento import Evento
from app.models.aula import Aula
from app.models.unidade_curricular import UnidadeCurricular
from app.services.regencia import calcular_regencia_todos


class IAService:
    def __init__(self):
        # Cliente assíncrono — não bloqueia o event loop
        self.client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = "claude-opus-4-8"

    async def _get_contexto_academico(self, db: AsyncSession) -> dict:
        """
        Coleta contexto compacto do banco para alimentar a IA.
        Mantém o payload abaixo de ~3 000 tokens para respeitar rate limits.
        """
        hoje = date.today()
        janela_fim = hoje + timedelta(days=45)

        # Professores ativos
        result_profs = await db.execute(select(Professor).where(Professor.ativo == True))
        professores = result_profs.scalars().all()

        # Regência calculada
        regencias = await calcular_regencia_todos(db)
        reg_map = {r["professor_id"]: r for r in regencias}

        # Contagem de aulas futuras por professor
        result_aulas_fut = await db.execute(
            select(Aula.professor_id, func.count(Aula.id).label("qtd"))
            .where(and_(Aula.data >= hoje, Aula.data <= janela_fim))
            .group_by(Aula.professor_id)
        )
        aulas_futuras_map = {row[0]: row[1] for row in result_aulas_fut.all()}

        # Aulas sem professor nos próximos 45 dias (por evento)
        result_sem = await db.execute(
            select(Aula.evento_id, func.count(Aula.id).label("qtd"))
            .where(and_(Aula.professor_id == None, Aula.data >= hoje, Aula.data <= janela_fim))
            .group_by(Aula.evento_id)
        )
        sem_prof_por_evento = {row[0]: row[1] for row in result_sem.all()}
        total_sem_prof = sum(sem_prof_por_evento.values())

        # Resumo compacto por professor (ordenado: críticos primeiro)
        profs_resumo = []
        for p in professores:
            reg = reg_map.get(p.id, {})
            profs_resumo.append({
                "nome": p.nome,
                "tipo": p.tipo,
                "ch": p.horas_contratadas,
                "reg_pct": round(reg.get("percentual_regencia", 0), 1),
                "status": reg.get("status", "—"),
                "aulas_futuras_45d": aulas_futuras_map.get(p.id, 0),
            })
        # Ordena: Critico → Alerta → OK → Sobrecarga, limita a 25
        ordem = {"Critico": 0, "Alerta": 1, "OK": 2, "Sobrecarga": 3}
        profs_resumo.sort(key=lambda x: ordem.get(x["status"], 9))
        profs_resumo = profs_resumo[:25]

        # Eventos com aulas sem professor (top 10)
        result_ev = await db.execute(
            select(Evento).where(Evento.id.in_(list(sem_prof_por_evento.keys())))
        )
        eventos_criticos = []
        for ev in result_ev.scalars().all():
            eventos_criticos.append({
                "turma": ev.nome_turma,
                "disciplina": ev.disciplina,
                "status": ev.status,
                "aulas_sem_prof": sem_prof_por_evento.get(ev.id, 0),
            })
        eventos_criticos.sort(key=lambda x: -x["aulas_sem_prof"])
        eventos_criticos = eventos_criticos[:10]

        # Totais gerais de eventos
        result_total_ev = await db.execute(select(func.count(Evento.id)))
        total_eventos = result_total_ev.scalar() or 0

        return {
            "data": hoje.isoformat(),
            "janela": f"próximos 45 dias até {janela_fim.isoformat()}",
            "totais": {
                "professores_ativos": len(professores),
                "eventos": total_eventos,
                "aulas_sem_professor_proximos_45d": total_sem_prof,
                "professores_criticos": sum(1 for p in profs_resumo if p["status"] == "Critico"),
                "professores_alerta": sum(1 for p in profs_resumo if p["status"] == "Alerta"),
                "professores_sobrecarga": sum(1 for p in profs_resumo if p["status"] == "Sobrecarga"),
            },
            "professores": profs_resumo,
            "eventos_com_aulas_sem_professor": eventos_criticos,
        }

    async def analisar_cronograma(self, db: AsyncSession, pergunta: str | None = None) -> str:
        contexto = await self._get_contexto_academico(db)

        system = """Você é um assistente especialista em planejamento acadêmico para o SENAI.
Analise os dados do cronograma fornecidos e gere sugestões práticas.

REGRAS ABSOLUTAS:
- NUNCA invente professores, disciplinas, turmas ou horários que não existam nos dados
- Baseie TODAS as sugestões nos dados reais fornecidos no contexto
- Use nomes exatos dos professores e turmas como aparecem nos dados
- Se não há dados suficientes, diga isso claramente
- Responda em português brasileiro com formatação Markdown"""

        user = f"""Contexto do sistema SENAI em {contexto['data']} ({contexto['janela']}):

{json.dumps(contexto, ensure_ascii=False, indent=2, default=str)}

{f"Pergunta: {pergunta}" if pergunta else "Faça uma análise geral da situação atual."}

Responda em português com Markdown. Use tabelas quando comparar vários professores ou eventos.
Baseie-se EXCLUSIVAMENTE nos dados acima."""

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=system,
            messages=[{"role": "user", "content": user}],
        ) as stream:
            response = await stream.get_final_message()

        return "\n".join(b.text for b in response.content if hasattr(b, "text"))

    async def sugerir_professor_alternativo(
        self,
        evento_id: int,
        data_aula: date,
        alternativas: list[dict],
        db: AsyncSession,
    ) -> str:
        if not alternativas:
            return "Nenhum professor alternativo disponível foi encontrado para este horário."

        result = await db.execute(select(Evento).where(Evento.id == evento_id))
        evento = result.scalar_one_or_none()
        if not evento:
            return "Evento não encontrado."

        regencias = await calcular_regencia_todos(db)
        reg_map = {r["professor_id"]: r for r in regencias}

        alternativas_com_regencia = [
            {
                **alt,
                "percentual_regencia": reg_map.get(alt["professor_id"], {}).get("percentual_regencia", 0),
                "status_regencia": reg_map.get(alt["professor_id"], {}).get("status", "N/A"),
            }
            for alt in alternativas
        ]

        prompt = f"""Preciso escolher o melhor professor substituto para a aula abaixo.

TURMA: {evento.nome_turma}
DISCIPLINA: {evento.disciplina}
DATA: {data_aula}

PROFESSORES DISPONÍVEIS (dados reais):
{json.dumps(alternativas_com_regencia, ensure_ascii=False, indent=2)}

Recomende UM professor específico e justifique considerando:
- Nível de competência na disciplina (maior = melhor)
- Percentual de regência atual (prefira quem está abaixo da meta de 70%)
- Equilíbrio de carga de trabalho

Responda de forma concisa: Professor recomendado + motivo em 2-3 linhas."""

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=512,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = await stream.get_final_message()

        return "\n".join(b.text for b in response.content if hasattr(b, "text"))

    async def gerar_relatorio_executivo(self, db: AsyncSession, tipo: str = "mensal") -> str:
        contexto = await self._get_contexto_academico(db)

        prompt = f"""Você é especialista em gestão acadêmica do SENAI.
Com base EXCLUSIVAMENTE nos dados abaixo, gere um relatório executivo {tipo} em Markdown.

DADOS (referência: {contexto['data']}, {contexto['janela']}):
{json.dumps(contexto, ensure_ascii=False, indent=2, default=str)}

Estrutura obrigatória:

# Relatório Executivo — SENAI ({tipo.capitalize()})

## Resumo Executivo
2-3 parágrafos com a situação geral.

## Regência Docente
Tabela com colunas: Professor | Tipo | CH | Regência % | Status
Inclua todos os professores dos dados. Ordene por status (Critico primeiro).

## Turmas com Aulas sem Professor
Tabela: Turma | Disciplina | Aulas sem Prof. | Ação sugerida
Se não houver, diga "Nenhuma turma com pendência".

## Pontos de Atenção
Lista de alertas prioritários com base nos dados.

## Recomendações
3 a 5 ações concretas com nomes reais dos professores/turmas dos dados.

Não invente dados que não estejam no contexto acima."""

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=8192,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = await stream.get_final_message()

        return "\n".join(b.text for b in response.content if hasattr(b, "text"))

    async def revisar_planejamento(
        self,
        evento: dict,
        alocacoes: list[dict],
        regencias_projetadas: list[dict],
        alertas: list[str],
    ) -> dict:
        contexto = {
            "evento": evento,
            "alocacoes_propostas": alocacoes,
            "regencias_projetadas": [r for r in regencias_projetadas if r.get("horas_planejadas", 0) > 0],
            "alertas_regencia": alertas,
        }

        prompt = f"""Você é especialista em planejamento acadêmico SENAI. Revise a proposta abaixo.

PROPOSTA DE PLANEJAMENTO (dados reais do sistema):
{json.dumps(contexto, ensure_ascii=False, indent=2, default=str)}

Analise e responda em JSON com exatamente esta estrutura:
{{
  "sugestoes": ["sugestão 1", "sugestão 2"],
  "alertas_criticos": ["alerta 1"],
  "justificativas": {{"uc_id_como_string": "justificativa específica"}},
  "avaliacao_geral": "OK | ATENÇÃO | CRÍTICO",
  "resumo": "texto curto de 2-3 linhas resumindo a qualidade do planejamento"
}}

REGRAS:
- Use apenas professores e UCs mencionados nos dados
- Priorize sugestões que aumentem a regência para a meta de 70%
- Seja objetivo e conciso
- Responda SOMENTE o JSON, sem texto antes ou depois"""

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=2048,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            response = await stream.get_final_message()

        raw = "\n".join(b.text for b in response.content if hasattr(b, "text")).strip()

        try:
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                return json.loads(match.group())
        except Exception:
            pass

        return {
            "sugestoes": [],
            "alertas_criticos": alertas,
            "justificativas": {},
            "avaliacao_geral": "ATENÇÃO",
            "resumo": raw[:500],
        }


ia_service = IAService()
