"""
Serviço de geração automática de cronograma (planejamento inteligente).

Objetivo principal: maximizar a regência dos professores (meta 70% CH contratada).

Algoritmo greedy com scoring:
  score = 0.4*(necessidade_regencia) + 0.3*(preferido) + 0.2*(competencia) + 0.1*(sem_conflito)
"""
import math
import random
from datetime import date, datetime, timedelta
from dataclasses import dataclass, field
from typing import Any

# Candidatos dentro desta distância do top score concorrem igualmente (aleatoriedade controlada)
SCORE_TOLERANCE = 0.15

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.aula import Aula
from app.models.evento import Evento
from app.models.professor import Professor
from app.models.atuacao import Atuacao
from app.models.unidade_curricular import UnidadeCurricular
from app.algorithms.constraint_solver import (
    get_datas_letivas,
    verificar_conflito_professor,
    verificar_disponibilidade_professor,
)
from app.services.regencia import calcular_regencia_professor, META_REGENCIA_MENSALISTA


@dataclass
class AlocacaoUC:
    uc_id: int
    uc_nome: str
    uc_codigo: str
    etapa: str | None
    carga_horaria: int
    professor_id: int | None
    professor_nome: str | None
    aulas_necessarias: int
    datas_aulas: list[date]
    justificativa: str
    alerta: str | None = None
    score: float = 0.0


@dataclass
class PlanejamentoResult:
    evento_id: int
    alocacoes: list[AlocacaoUC]
    regencia_projetada: list[dict]          # por professor
    conflitos: list[dict]
    alertas_regencia: list[str]
    sugestoes_ia: list[str] = field(default_factory=list)
    total_aulas: int = 0
    horas_planejadas: float = 0.0


def _horas_aula(evento: Evento) -> float:
    base = date.today()
    ini = datetime.combine(base, evento.horario_inicio)
    fim = datetime.combine(base, evento.horario_fim)
    return max(0.5, (fim - ini).seconds / 3600)


def _turno(evento: Evento) -> str:
    h = evento.horario_inicio.hour
    if h < 12:
        return "Manhã"
    if h < 18:
        return "Tarde"
    return "Noite"


async def _candidatos_uc(
    uc: UnidadeCurricular,
    evento: Evento,
    preferidos: list[int],
    regencias_atuais: dict[int, dict],
    db: AsyncSession,
    verificar_disponibilidade: bool = True,
) -> list[dict]:
    """
    Retorna professores candidatos para uma UC, com score calculado.
    Critérios:
      - Tem atuação para a disciplina (match por curso_id ou por nome da UC)
      - Disponível nos dias/horário do evento (apenas quando verificar_disponibilidade=True)
    """
    result = await db.execute(
        select(Professor).where(Professor.ativo == True)
    )
    todos = result.scalars().all()

    candidatos = []
    for prof in todos:
        # 1. Verifica habilitação: atuacao vinculada ao mesmo curso da UC
        res_at = await db.execute(
            select(Atuacao).where(
                and_(
                    Atuacao.professor_id == prof.id,
                    Atuacao.curso_id == uc.curso_id,
                )
            )
        )
        atuacoes_curso = res_at.scalars().all()

        # Também aceita match por nome da UC dentro das disciplinas do professor
        res_at2 = await db.execute(
            select(Atuacao).where(
                and_(
                    Atuacao.professor_id == prof.id,
                    Atuacao.disciplina.ilike(f"%{uc.nome[:30]}%"),
                )
            )
        )
        atuacoes_uc = res_at2.scalars().all()

        todas_atuacoes = list(atuacoes_curso) + list(atuacoes_uc)
        if not todas_atuacoes:
            continue

        nivel_competencia = max((a.nivel_competencia for a in todas_atuacoes), default=3)

        # 2. Disponibilidade nos dias do evento (só no planejamento automático)
        disponivel = True
        if verificar_disponibilidade:
            for dia in (evento.dias_semana or []):
                ok = await verificar_disponibilidade_professor(
                    prof.id, dia, evento.horario_inicio, evento.horario_fim, db
                )
                if not ok:
                    disponivel = False
                    break

        # 3. Score (inclui penalidade leve se indisponível, mas não exclui)
        reg = regencias_atuais.get(prof.id, {})
        percentual = reg.get("percentual_regencia", 0) / 100
        meta = META_REGENCIA_MENSALISTA if prof.tipo == "Mensalista" else 1.0

        necessidade = max(0.0, 1.0 - (percentual / meta)) if meta > 0 else 0.5
        is_preferido = 1.0 if prof.id in preferidos else 0.0
        bonus_disponivel = 0.1 if disponivel else 0.0

        score = (
            0.40 * necessidade
            + 0.30 * is_preferido
            + 0.20 * (nivel_competencia / 5)
            + 0.10 * bonus_disponivel
        )

        candidatos.append({
            "professor": prof,
            "nivel_competencia": nivel_competencia,
            "is_preferido": bool(is_preferido),
            "disponivel": disponivel,
            "score": round(score, 4),
            "percentual_regencia": reg.get("percentual_regencia", 0),
            "status_regencia": reg.get("status", "N/A"),
        })

    return sorted(candidatos, key=lambda x: x["score"], reverse=True)


async def gerar_planejamento(
    evento_id: int,
    ucs_ordenadas: list[dict],   # [{uc_id, ordem, professor_preferido_id?}]
    db: AsyncSession,
) -> PlanejamentoResult:
    """
    Gera proposta de cronograma sem salvar no banco.
    Retorna PlanejamentoResult com alocações, projeção de regência e alertas.
    """
    # 1. Carregar evento
    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento:
        raise ValueError(f"Evento {evento_id} não encontrado")

    horas_por_aula = _horas_aula(evento)
    turno = _turno(evento)

    # 2. Datas letivas disponíveis
    dias_semana = list(evento.dias_semana or [])

    # Auto-inferência: se dias_semana está vazio, deriva dos dias das aulas existentes no evento
    if not dias_semana:
        res_dias = await db.execute(select(Aula.data).where(Aula.evento_id == evento_id).limit(200))
        dias_inferidos = list(set(row[0].weekday() for row in res_dias.fetchall()))
        if dias_inferidos:
            dias_semana = sorted(dias_inferidos)

    if not dias_semana:
        raise ValueError(
            f"O evento não possui dias da semana configurados e não há aulas anteriores para inferir. "
            "Recrie o evento pela oferta (que define os dias automaticamente) ou edite o evento para informar os dias."
        )

    # Se alguma UC tem data_inicio anterior ao evento, estende o pool para cobrir
    data_inicio_pool = evento.data_inicio
    for item in ucs_ordenadas:
        di = item.get("data_inicio")
        if di:
            try:
                dt = date.fromisoformat(di) if isinstance(di, str) else di
                if dt < data_inicio_pool:
                    data_inicio_pool = dt
            except (ValueError, TypeError):
                pass

    # Sábado (5) como fallback: preenche com dias úteis (seg–sex) primeiro;
    # datas de sábado são anexadas ao final e só consumidas se os dias úteis esgotarem.
    dias_sem_sabado = [d for d in dias_semana if d != 5]
    if dias_sem_sabado:
        datas_letivas_semana = await get_datas_letivas(
            data_inicio_pool, evento.data_fim, dias_sem_sabado, db
        )
        datas_letivas_sabado = (
            await get_datas_letivas(data_inicio_pool, evento.data_fim, [5], db)
            if 5 in dias_semana else []
        )
        datas_letivas = datas_letivas_semana + datas_letivas_sabado
    else:
        datas_letivas = await get_datas_letivas(
            data_inicio_pool, evento.data_fim, dias_semana, db
        )

    if not datas_letivas:
        raise ValueError(
            f"Nenhuma data letiva encontrada para o período do evento "
            f"({evento.data_inicio} → {evento.data_fim}, dias: {dias_semana}). "
            "Verifique se o período está correto e se as datas não estão bloqueadas no calendário acadêmico."
        )

    # 3. Regências atuais de todos os professores
    result_profs = await db.execute(select(Professor).where(Professor.ativo == True))
    todos_profs = result_profs.scalars().all()
    regencias_atuais: dict[int, dict] = {}
    for prof in todos_profs:
        reg = await calcular_regencia_professor(prof, db)
        regencias_atuais[prof.id] = reg

    # 4. Projeção acumulada (horas a adicionar por professor neste planejamento)
    horas_projetadas: dict[int, float] = {}

    preferidos_global = evento.professores_preferidos or []

    alocacoes: list[AlocacaoUC] = []
    conflitos: list[dict] = []
    datas_usadas: list[date] = []   # rastreia datas já consumidas
    data_cursor = 0                  # próxima data letiva disponível
    # Datas já alocadas por professor neste preview (detecta choque intra-planejamento)
    professor_datas_planejadas: dict[int, set[date]] = {}
    # Datas já ocupadas por qualquer UC neste evento (um evento tem horário único — 1 UC/data)
    datas_ocupadas: set[date] = set()

    for item in sorted(ucs_ordenadas, key=lambda x: x.get("ordem", 0)):
        uc_id = item["uc_id"]
        prof_preferido_uc = item.get("professor_preferido_id")
        data_inicio_uc = item.get("data_inicio")   # data de início opcional para este módulo
        nao_agendar = item.get("nao_agendar", False)
        preferidos = list(set(preferidos_global + ([prof_preferido_uc] if prof_preferido_uc else [])))

        res_uc = await db.execute(select(UnidadeCurricular).where(UnidadeCurricular.id == uc_id))
        uc = res_uc.scalar_one_or_none()
        if not uc:
            conflitos.append({"uc_id": uc_id, "motivo": "UC não encontrada"})
            continue

        # UC EaD marcada como "não agendar": inclui no resultado sem gerar aulas
        if nao_agendar:
            alocacoes.append(AlocacaoUC(
                uc_id=uc_id,
                uc_nome=uc.nome,
                uc_codigo=uc.codigo_uc or "",
                etapa=uc.modulo_etapa,
                carga_horaria=uc.carga_horaria or 0,
                professor_id=None,
                professor_nome=None,
                aulas_necessarias=0,
                datas_aulas=[],
                justificativa="EaD — realizada de forma paralela sem necessidade de agendamento.",
                alerta=None,
                score=0.0,
            ))
            continue

        aulas_necessarias = math.ceil((uc.carga_horaria or 0) / horas_por_aula) if horas_por_aula > 0 else 0
        if aulas_necessarias == 0:
            aulas_necessarias = 1

        # Dias específicos para esta UC (override do evento)
        dias_semana_uc = item.get("dias_semana") or []

        if dias_semana_uc:
            # Pool de datas independente para os dias escolhidos nesta UC
            # Usa data_inicio_pool (já estendida) para cobrir data_inicio_uc anteriores ao evento
            data_inicio_pool_uc = data_inicio_pool
            if data_inicio_uc:
                try:
                    dt = date.fromisoformat(data_inicio_uc) if isinstance(data_inicio_uc, str) else data_inicio_uc
                    if dt < data_inicio_pool_uc:
                        data_inicio_pool_uc = dt
                except (ValueError, TypeError):
                    pass
            datas_pool_uc = await get_datas_letivas(
                data_inicio_pool_uc, evento.data_fim, dias_semana_uc, db
            )
            cursor_uc = 0
            if data_inicio_uc:
                try:
                    dt_ini = date.fromisoformat(data_inicio_uc) if isinstance(data_inicio_uc, str) else data_inicio_uc
                    while cursor_uc < len(datas_pool_uc) and datas_pool_uc[cursor_uc] < dt_ini:
                        cursor_uc += 1
                except (ValueError, TypeError):
                    pass
            datas_uc: list[date] = []
            while len(datas_uc) < aulas_necessarias and cursor_uc < len(datas_pool_uc):
                d = datas_pool_uc[cursor_uc]
                cursor_uc += 1
                if d not in datas_ocupadas:
                    datas_uc.append(d)
        else:
            # Pool compartilhado do evento (comportamento padrão)
            if data_inicio_uc:
                try:
                    dt_ini = date.fromisoformat(data_inicio_uc) if isinstance(data_inicio_uc, str) else data_inicio_uc
                    while data_cursor < len(datas_letivas) and datas_letivas[data_cursor] < dt_ini:
                        data_cursor += 1
                except (ValueError, TypeError):
                    pass
            datas_uc: list[date] = []
            while len(datas_uc) < aulas_necessarias and data_cursor < len(datas_letivas):
                d = datas_letivas[data_cursor]
                data_cursor += 1
                if d not in datas_ocupadas:
                    datas_uc.append(d)

        # Marca datas como ocupadas para as UCs seguintes deste evento
        datas_ocupadas.update(datas_uc)

        if not datas_uc:
            conflitos.append({"uc_id": uc_id, "uc_nome": uc.nome, "motivo": "Sem datas letivas disponíveis"})

        # Encontrar melhor professor para esta UC
        candidatos = await _candidatos_uc(uc, evento, preferidos, regencias_atuais, db)

        professor_escolhido = None
        professor_nome = None
        alerta = None
        justificativa = "Sem candidatos habilitados e disponíveis para esta UC."
        score_escolhido = 0.0
        cand = None

        # Professor selecionado explicitamente: prioridade absoluta, independente de atuação/score
        if prof_preferido_uc:
            cand = next((c for c in candidatos if c["professor"].id == prof_preferido_uc), None)
            if cand is None:
                # Professor não está nos candidatos (sem atuação ou disponibilidade cadastrada)
                # Carrega direto do banco e usa mesmo assim (usuário fez escolha explícita)
                res_pref = await db.execute(
                    select(Professor).where(Professor.id == prof_preferido_uc, Professor.ativo == True)
                )
                prof_direto = res_pref.scalar_one_or_none()
                if prof_direto:
                    reg = regencias_atuais.get(prof_direto.id, {})
                    cand = {
                        "professor": prof_direto,
                        "nivel_competencia": 3,
                        "is_preferido": True,
                        "score": 0.0,
                        "percentual_regencia": reg.get("percentual_regencia", 0),
                        "status_regencia": reg.get("status", "N/A"),
                    }
                    alerta = (
                        f"Prof. {prof_direto.nome} selecionado manualmente — "
                        "habilitação ou disponibilidade não cadastrada para esta UC."
                    )
            # Aviso se o professor escolhido já está alocado em outra UC nas mesmas datas
            if cand and datas_uc:
                datas_choque = professor_datas_planejadas.get(cand["professor"].id, set()).intersection(datas_uc)
                if datas_choque:
                    alerta = (
                        f"CONFLITO: Prof. {cand['professor'].nome} já possui outra UC alocada neste "
                        f"planejamento em {len(datas_choque)} data(s) coincidente(s). Revise manualmente."
                    )

        if cand is None and candidatos:
            # Seleção por score: filtra conflito de banco E conflito intra-planejamento
            sem_conflito = []
            for c in candidatos:
                tem_conflito = False
                if datas_uc:
                    # Conflito com aulas já salvas no banco
                    tem_conflito = await verificar_conflito_professor(
                        c["professor"].id, datas_uc[0], evento.horario_inicio, evento.horario_fim, db
                    )
                    # Conflito com outra UC já alocada neste preview (mesmo evento, mesma data/horário)
                    if not tem_conflito:
                        datas_prof = professor_datas_planejadas.get(c["professor"].id, set())
                        if datas_prof.intersection(datas_uc):
                            tem_conflito = True
                if not tem_conflito:
                    sem_conflito.append(c)

            pool = sem_conflito if sem_conflito else candidatos
            top_score = pool[0]["score"]
            grupo = [c for c in pool if (top_score - c["score"]) <= SCORE_TOLERANCE]
            preferidos_no_grupo = [c for c in grupo if c["is_preferido"]]
            cand = preferidos_no_grupo[0] if preferidos_no_grupo else random.choice(grupo)

            if not sem_conflito:
                alerta = f"Conflito detectado para {cand['professor'].nome} na 1ª data. Revisar manualmente."
            elif preferidos and not cand["is_preferido"]:
                alerta = f"Professor preferido não disponível/habilitado; alocado {cand['professor'].nome}."

        if cand:
            professor_escolhido = cand["professor"]
            score_escolhido = cand["score"]
            reg_pct = cand["percentual_regencia"]
            preferido_str = " (preferido)" if cand["is_preferido"] else ""
            professor_nome = professor_escolhido.nome

            justificativa = (
                f"Prof. {professor_nome}{preferido_str} — regência atual {reg_pct:.1f}%, "
                f"competência nível {cand['nivel_competencia']}/5, "
                f"score {score_escolhido:.3f}."
            )

            # Acumula horas projetadas
            horas_projetadas[professor_escolhido.id] = (
                horas_projetadas.get(professor_escolhido.id, 0) + aulas_necessarias * horas_por_aula
            )
            # Registra datas para detecção de choque intra-planejamento
            if datas_uc:
                if professor_escolhido.id not in professor_datas_planejadas:
                    professor_datas_planejadas[professor_escolhido.id] = set()
                professor_datas_planejadas[professor_escolhido.id].update(datas_uc)

        alocacoes.append(AlocacaoUC(
            uc_id=uc_id,
            uc_nome=uc.nome,
            uc_codigo=uc.codigo_uc or "",
            etapa=uc.modulo_etapa,
            carga_horaria=uc.carga_horaria or 0,
            professor_id=professor_escolhido.id if professor_escolhido else None,
            professor_nome=professor_nome,
            aulas_necessarias=aulas_necessarias,
            datas_aulas=datas_uc,
            justificativa=justificativa,
            alerta=alerta,
            score=score_escolhido,
        ))

    # 5. Calcular regência projetada
    regencia_projetada = []
    alertas_regencia = []
    for prof in todos_profs:
        reg = regencias_atuais.get(prof.id, {})
        horas_atuais = reg.get("horas_ministradas", 0)
        horas_add = horas_projetadas.get(prof.id, 0)
        horas_total = horas_atuais + horas_add
        horas_contratadas = prof.horas_contratadas

        # Para Mensalista: comparar com carga semanal * semanas do evento
        semanas = max(1, (evento.data_fim - evento.data_inicio).days / 7)
        horas_periodo = horas_contratadas * semanas if prof.tipo == "Mensalista" else horas_contratadas
        pct_projetado = (horas_total / horas_periodo * 100) if horas_periodo > 0 else 0

        entrada = {
            "professor_id": prof.id,
            "nome": prof.nome,
            "tipo": prof.tipo,
            "horas_contratadas": horas_contratadas,
            "horas_atuais": round(horas_atuais, 1),
            "horas_planejadas": round(horas_add, 1),
            "horas_projetadas": round(horas_total, 1),
            "percentual_atual": reg.get("percentual_regencia", 0),
            "percentual_projetado": round(pct_projetado, 1),
            "meta": 70.0 if prof.tipo == "Mensalista" else None,
        }
        regencia_projetada.append(entrada)

        if horas_add > 0:
            meta = 70.0 if prof.tipo == "Mensalista" else None
            if meta and pct_projetado < meta:
                alertas_regencia.append(
                    f"{prof.nome}: projeção de {pct_projetado:.1f}% — abaixo da meta de {meta:.0f}%."
                )

    # Conta aulas reais agendadas (comprimento de datas_aulas), não teóricas
    total_aulas = sum(len(a.datas_aulas) for a in alocacoes)
    horas_planejadas = total_aulas * horas_por_aula

    return PlanejamentoResult(
        evento_id=evento_id,
        alocacoes=alocacoes,
        regencia_projetada=regencia_projetada,
        conflitos=conflitos,
        alertas_regencia=alertas_regencia,
        total_aulas=total_aulas,
        horas_planejadas=round(horas_planejadas, 1),
    )


async def confirmar_planejamento(
    evento_id: int,
    alocacoes: list[dict],   # serialized AlocacaoUC dicts
    substituir_futuras: bool,
    db: AsyncSession,
) -> dict:
    """
    Salva as aulas propostas no banco.
    Se substituir_futuras=True, apaga aulas futuras não travadas do evento.
    """
    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento:
        raise ValueError(f"Evento {evento_id} não encontrado")

    turno = _turno(evento)

    if substituir_futuras:
        uc_ids_no_plano = {aloc.get("uc_id") for aloc in alocacoes if aloc.get("uc_id")}

        # Usa a data mais antiga do novo plano como corte de deleção,
        # permitindo substituir aulas passadas quando a data de início é anterior a hoje.
        todas_datas = [
            date.fromisoformat(str(d))
            for aloc in alocacoes
            for d in aloc.get("datas_aulas", [])
        ]
        data_corte = min(todas_datas) if todas_datas else date.today()

        del_conditions = [
            Aula.evento_id == evento_id,
            Aula.data >= data_corte,
            Aula.alterada_manualmente == False,
        ]
        if uc_ids_no_plano:
            del_conditions.append(Aula.unidade_curricular_id.in_(uc_ids_no_plano))
        res_del = await db.execute(select(Aula).where(and_(*del_conditions)))
        for aula in res_del.scalars().all():
            await db.delete(aula)

    inseridas = 0
    numero_seq = 1

    for aloc in alocacoes:
        prof_id = aloc.get("professor_id")
        uc_id = aloc.get("uc_id")
        etapa = aloc.get("etapa")
        datas = aloc.get("datas_aulas", [])

        for d_raw in datas:
            d = d_raw if isinstance(d_raw, date) else date.fromisoformat(str(d_raw))

            # Verifica duplicata (pode haver múltiplas aulas na mesma data/hora — usar first())
            res_ex = await db.execute(
                select(Aula).where(
                    and_(
                        Aula.evento_id == evento_id,
                        Aula.data == d,
                        Aula.horario_inicio == evento.horario_inicio,
                        Aula.unidade_curricular_id == uc_id,
                    )
                )
            )
            if res_ex.scalars().first():
                continue

            # Tipo contrato
            tipo_contrato = None
            if prof_id:
                res_p = await db.execute(select(Professor).where(Professor.id == prof_id))
                p = res_p.scalar_one_or_none()
                tipo_contrato = p.tipo if p else None

            aula = Aula(
                evento_id=evento_id,
                professor_id=prof_id,
                unidade_curricular_id=uc_id,
                data=d,
                horario_inicio=evento.horario_inicio,
                horario_fim=evento.horario_fim,
                etapa=etapa,
                turno=turno,
                numero_aula=numero_seq,
                tipo_contrato=tipo_contrato,
                status="Agendada",
                tipo="Regular",
                alterada_manualmente=False,
            )
            db.add(aula)
            inseridas += 1
            numero_seq += 1

    await db.flush()
    return {"inseridas": inseridas, "evento_id": evento_id}


def analisar_proprio(resultado: PlanejamentoResult) -> dict:
    """
    Gera análise do planejamento sem dependências externas.
    Cruza regência projetada, alocações, alertas e conflitos para produzir
    avaliação, alertas críticos, sugestões e resumo executivo.
    """
    alocacoes = resultado.alocacoes
    reg_proj = resultado.regencia_projetada
    conflitos = resultado.conflitos
    alertas_reg = resultado.alertas_regencia

    # ── métricas gerais ────────────────────────────────────────────────────────
    total_ucs = len(alocacoes)
    ucs_sem_professor = [a for a in alocacoes if a.professor_id is None]
    ucs_com_alerta = [a for a in alocacoes if a.alerta]
    professores_alocados = {a.professor_id for a in alocacoes if a.professor_id}

    # Professores que receberão horas neste planejamento
    profs_com_aulas = [r for r in reg_proj if r["horas_planejadas"] > 0]

    abaixo_meta = [
        r for r in profs_com_aulas
        if r.get("meta") and r["percentual_projetado"] < r["meta"]
    ]
    acima_meta = [
        r for r in profs_com_aulas
        if r.get("meta") and r["percentual_projetado"] >= r["meta"]
    ]
    sobrecarga = [
        r for r in profs_com_aulas
        if r.get("meta") and r["percentual_projetado"] > 110
    ]

    # Score médio das alocações que tiveram candidatos
    scores = [a.score for a in alocacoes if a.score > 0]
    score_medio = sum(scores) / len(scores) if scores else 0

    # ── avaliação geral ────────────────────────────────────────────────────────
    if not ucs_sem_professor and not conflitos and len(abaixo_meta) == 0:
        avaliacao_geral = "Ótimo"
        avaliacao_descricao = (
            f"Todas as {total_ucs} UCs foram alocadas com professores habilitados "
            f"e {len(acima_meta)} professor(es) atingirão a meta de regência."
        )
    elif len(ucs_sem_professor) > total_ucs * 0.3 or len(conflitos) > 2:
        avaliacao_geral = "Crítico"
        avaliacao_descricao = (
            f"{len(ucs_sem_professor)} UC(s) sem professor habilitado e "
            f"{len(conflitos)} conflito(s) identificados. Revisão necessária antes de confirmar."
        )
    elif ucs_sem_professor or len(abaixo_meta) > len(acima_meta):
        avaliacao_geral = "Atenção"
        avaliacao_descricao = (
            f"Planejamento viável com ressalvas: {len(ucs_sem_professor)} UC(s) sem professor "
            f"e {len(abaixo_meta)} professor(es) ainda abaixo da meta após este planejamento."
        )
    else:
        avaliacao_geral = "Bom"
        avaliacao_descricao = (
            f"{total_ucs} UCs alocadas. {len(abaixo_meta)} professor(es) ficará(ão) abaixo da meta — "
            f"considere redistribuir UCs ou adicionar eventos extras."
        )

    # ── alertas críticos ───────────────────────────────────────────────────────
    alertas_criticos: list[str] = []

    if ucs_sem_professor:
        nomes = ", ".join(a.uc_nome for a in ucs_sem_professor[:3])
        extra = f" e mais {len(ucs_sem_professor) - 3}" if len(ucs_sem_professor) > 3 else ""
        alertas_criticos.append(
            f"Sem professor habilitado: {nomes}{extra}. "
            "Verifique atuações cadastradas ou adicione professores qualificados."
        )

    for c in conflitos[:3]:
        alertas_criticos.append(
            f"Conflito na UC '{c.get('uc_nome', c.get('uc_id', '?'))}': {c.get('motivo', 'não especificado')}."
        )

    for r in sobrecarga[:3]:
        alertas_criticos.append(
            f"Sobrecarga: {r['nome']} estará em {r['percentual_projetado']:.1f}% de regência "
            f"({r['horas_planejadas']:.1f}h planejadas). Considere redistribuir."
        )

    for alerta in alertas_reg[:3]:
        if alerta not in alertas_criticos:
            alertas_criticos.append(alerta)

    # ── sugestões ─────────────────────────────────────────────────────────────
    sugestoes: list[str] = []

    if abaixo_meta:
        nomes_baixos = ", ".join(r["nome"] for r in abaixo_meta[:3])
        sugestoes.append(
            f"Professores {nomes_baixos} continuarão abaixo de 70% mesmo com este planejamento. "
            "Avalie criar eventos adicionais ou aumentar a frequência semanal."
        )

    if score_medio < 0.45:
        sugestoes.append(
            f"Score médio das alocações é {score_medio:.2f} (baixo). "
            "Considere cadastrar mais atuações para ampliar o pool de candidatos por UC."
        )

    if ucs_com_alerta:
        for a in ucs_com_alerta[:2]:
            sugestoes.append(f"UC '{a.uc_nome}': {a.alerta}")

    # Professores com alta regência atual que não receberam aulas
    sem_aulas_alta_reg = [
        r for r in reg_proj
        if r["horas_planejadas"] == 0
        and r.get("percentual_atual", 0) < 40
        and r.get("meta")
    ]
    if sem_aulas_alta_reg:
        nomes_ociosos = ", ".join(r["nome"] for r in sem_aulas_alta_reg[:2])
        sugestoes.append(
            f"Professores com baixa regência sem aulas neste planejamento: {nomes_ociosos}. "
            "Verifique se possuem atuações cadastradas para as UCs deste evento."
        )

    if not sugestoes:
        sugestoes.append(
            "Distribuição equilibrada. Confirme o planejamento e monitore a execução."
        )

    # ── resumo executivo ───────────────────────────────────────────────────────
    profs_atingindo = len(acima_meta)
    profs_total_alocados = len(profs_com_aulas)
    resumo = (
        f"{avaliacao_geral}: {total_ucs} UCs planejadas, "
        f"{resultado.total_aulas} aulas totais ({resultado.horas_planejadas:.1f}h). "
        f"{profs_atingindo}/{profs_total_alocados} professor(es) atingirá(ão) a meta de 70%. "
    )
    if alertas_criticos:
        resumo += f"{len(alertas_criticos)} alerta(s) crítico(s) requerem atenção."
    else:
        resumo += "Nenhum alerta crítico."

    return {
        "avaliacao_geral": avaliacao_geral,
        "avaliacao_descricao": avaliacao_descricao,
        "alertas_criticos": alertas_criticos,
        "sugestoes": sugestoes,
        "resumo": resumo,
        "metricas": {
            "total_ucs": total_ucs,
            "ucs_sem_professor": len(ucs_sem_professor),
            "ucs_com_alerta": len(ucs_com_alerta),
            "professores_alocados": len(professores_alocados),
            "professores_acima_meta": profs_atingindo,
            "professores_abaixo_meta": len(abaixo_meta),
            "score_medio_alocacoes": round(score_medio, 3),
            "total_conflitos": len(conflitos),
        },
    }
