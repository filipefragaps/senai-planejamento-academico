"""
Gestão da Não Regência Docente — regras de carga horária, alertas e progresso.

Unidade de tempo: hora-relógio em todo o módulo. A regência do sistema já é calculada pela duração real das
aulas (horário de início/fim), e a carga contratual do professor (`horas_contratadas`) é semanal; por isso não
há conversão hora-aula ⇄ hora-relógio aqui.

Carga num período [início, fim] — calculada dia a dia, sem semanas fixas por mês:
- Dias de trabalho: dias da semana configurados (padrão seg–sex), menos as datas do Calendário Acadêmico não
  letivas cujo tipo está configurado como "não útil" (padrão: Feriado).
- Carga contratual = horas semanais ÷ nº de dias de trabalho na semana × dias de trabalho do período.
- Indisponível = a mesma conta nos dias de afastamento do professor.
- Reserva de planejamento = % configurável da carga disponível (padrão 0%: decisão institucional pendente).
- Regência prevista = aulas Agendadas + Realizadas; realizada = só Realizadas. Mesmo critério do cálculo de
  regência existente (slot dia+horário contado uma vez); o indicador de regência não é alterado nem recebe
  horas de projeto.
- Não regência prevista = vínculos aprovados (ou encerrados, até a data de encerramento) × carga semanal
  vigente em cada dia, fora dos dias de afastamento e limitada à conclusão do projeto. Propostas à parte.
- Outras alocações = alocações institucionais cadastradas no módulo, pela mesma regra diária.
- Saldo previsto = disponível − reserva − regência prevista − não regência prevista − outras alocações.
Horas informadas/validadas vêm dos apontamentos, rateadas pelos dias do lançamento quando ele é semanal.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.aula import Aula
from app.models.calendario import CalendarioAcademico
from app.models.nao_regencia import (
    NrAfastamento, NrApontamento, NrCategoria, NrConfig, NrEntrega, NrHistorico, NrOutraAlocacao, NrProjeto,
    NrVinculo,
)
from app.models.professor import Professor
from app.models.usuario import Usuario
from app.services.regencia import (
    META_REGENCIA_MENSALISTA, _TIPOS_MENSALISTA, _horas_aula, _semanas_uteis, calcular_status_regencia,
)

FUSO_BR = timezone(timedelta(hours=-3))

CATEGORIAS_PADRAO = [
    "Pesquisa e inovação",
    "Extensão",
    "Desenvolvimento tecnológico",
    "Consultoria e serviços tecnológicos",
    "Coordenação acadêmica",
    "Desenvolvimento de cursos e materiais didáticos",
    "Estruturação de laboratórios",
    "Atividades institucionais e comissões",
    "Outros",
]

SITUACAO_PROJETO = {
    "rascunho": "Rascunho", "planejado": "Planejado", "em_andamento": "Em andamento",
    "suspenso": "Suspenso", "concluido": "Concluído", "cancelado": "Cancelado",
}
PROJETO_ENCERRADO = {"concluido", "cancelado"}
PRIORIDADE = {"baixa": "Baixa", "media": "Média", "alta": "Alta"}
SITUACAO_VINCULO = {"proposta": "Proposta", "aprovada": "Aprovada", "encerrada": "Encerrada", "cancelada": "Cancelada"}
VINCULO_OFICIAL = {"aprovada", "encerrada"}
SITUACAO_ENTREGA = {
    "nao_iniciada": "Não iniciada", "em_andamento": "Em andamento", "submetida": "Submetida para validação",
    "aprovada": "Aprovada", "devolvida": "Devolvida para ajustes",
}
SITUACAO_APONTAMENTO = {"rascunho": "Rascunho", "enviado": "Enviado", "aprovado": "Aprovado", "devolvido": "Devolvido"}
TIPOS_AFASTAMENTO = ["Férias", "Licença médica", "Licença maternidade/paternidade", "Afastamento", "Capacitação", "Outro"]

# Perfis do sistema com papel de gestão/supervisão no módulo (acompanham tudo e aprovam alocações).
PERFIS_GESTAO = {"admin", "coordenador", "analista"}

# chave: (valor padrão, explicação, decisão institucional pendente?)
CONFIG_PADRAO: dict[str, tuple[str, str, bool]] = {
    "limite_regencia_pct": (
        str(round(META_REGENCIA_MENSALISTA * 100)),
        "Regência abaixo deste percentual, com saldo sem alocação, gera alerta. Padrão: a meta de regência do "
        "mensalista já usada na aba Regência.", False),
    "saldo_minimo_alerta_h": (
        "4", "Saldo previsto sem alocação (horas no período) a partir do qual a regência baixa vira alerta.", False),
    "tolerancia_sobrecarga_h": (
        "0", "Horas negativas de saldo toleradas antes de sinalizar sobrecarga.", False),
    "tolerancia_apontamento_pct": (
        "10", "Percentual acima das horas previstas do vínculo a partir do qual o apontamento é sinalizado.", False),
    "dias_sem_movimentacao": (
        "30", "Dias sem nenhum registro no histórico para sinalizar projeto em andamento parado.", False),
    "dias_validacao_pendente": (
        "7", "Dias com horas enviadas sem validação para gerar alerta.", False),
    "reserva_planejamento_pct": (
        "0", "Percentual da carga disponível reservado para planejamento/preparo de aulas. O sistema não tem essa "
        "regra cadastrada hoje (a aba Regência só usa a meta de 70% para mensalistas): defina o percentual "
        "institucional. Com 0%, nada é reservado.", True),
    "dias_semana_trabalho": (
        "0,1,2,3,4", "Dias da semana com jornada (0 = segunda … 6 = domingo). A carga semanal é dividida "
        "igualmente entre eles.", False),
    "tipos_calendario_nao_util": (
        "Feriado", "Tipos do Calendário Acadêmico (datas não letivas) que reduzem a carga do professor, separados "
        "por vírgula. Recesso escolar nem sempre dispensa o docente: confirme a regra institucional.", True),
}


def hoje_br() -> date:
    return datetime.now(FUSO_BR).date()


def agora() -> datetime:
    return datetime.now(timezone.utc)


# ── Configuração e categorias ─────────────────────────────────────────────────

async def config(db: AsyncSession) -> dict[str, str]:
    salvos = dict((await db.execute(select(NrConfig.chave, NrConfig.valor))).all())
    return {k: (salvos.get(k) if salvos.get(k) not in (None, "") else padrao) for k, (padrao, _, _) in CONFIG_PADRAO.items()}


def num(cfg: dict, chave: str) -> float:
    try:
        return float(str(cfg[chave]).replace(",", "."))
    except (TypeError, ValueError):
        return float(CONFIG_PADRAO[chave][0])


def dias_semana(cfg: dict) -> set[int]:
    dias = {int(x) for x in str(cfg["dias_semana_trabalho"]).split(",") if x.strip().isdigit() and 0 <= int(x) <= 6}
    return dias or {0, 1, 2, 3, 4}


async def garantir_categorias(db: AsyncSession) -> None:
    # Nomes de projeto em maiúsculas (inclusive os cadastrados antes dessa regra)
    for p in (await db.execute(select(NrProjeto))).scalars().all():
        if p.nome and p.nome != p.nome.upper():
            p.nome = p.nome
    if (await db.execute(select(func.count(NrCategoria.id)))).scalar():
        return
    db.add_all([NrCategoria(nome=n, ordem=i) for i, n in enumerate(CATEGORIAS_PADRAO)])
    await db.flush()


# ── Usuários, papéis e histórico ──────────────────────────────────────────────

def eh_gestao(user: Usuario) -> bool:
    return user.perfil in PERFIS_GESTAO


async def professor_do_usuario(db: AsyncSession, user: Usuario) -> Optional[Professor]:
    """Professor ligado ao usuário logado (mesmo e-mail do cadastro de professores)."""
    if not user.email:
        return None
    return (await db.execute(
        select(Professor).where(func.lower(Professor.email) == user.email.strip().lower()).limit(1)
    )).scalar_one_or_none()


def registrar(db: AsyncSession, user: Optional[Usuario], entidade: str, entidade_id: Optional[int],
              projeto_id: Optional[int], acao: str, detalhe: Optional[str] = None,
              justificativa: Optional[str] = None) -> None:
    db.add(NrHistorico(
        projeto_id=projeto_id, entidade=entidade, entidade_id=entidade_id, acao=acao, detalhe=detalhe,
        justificativa=(justificativa or "").strip() or None,
        usuario_id=user.id if user else None, usuario_nome=user.nome if user else None,
    ))


# ── Calendário e rateio diário ────────────────────────────────────────────────

def _datas(ini: date, fim: date) -> Iterable[date]:
    d = ini
    while d <= fim:
        yield d
        d += timedelta(days=1)


@dataclass
class Calendario:
    dias_semana: set[int]
    nao_uteis: set[date]

    @property
    def dias_por_semana(self) -> int:
        return len(self.dias_semana)

    def util(self, d: date) -> bool:
        return d.weekday() in self.dias_semana and d not in self.nao_uteis

    def dias_uteis(self, ini: date, fim: date) -> list[date]:
        return [d for d in _datas(ini, fim) if self.util(d)]


async def calendario(db: AsyncSession, cfg: dict, ini: date, fim: date) -> Calendario:
    tipos = [t.strip() for t in str(cfg["tipos_calendario_nao_util"]).split(",") if t.strip()]
    nao_uteis: set[date] = set()
    if tipos:
        nao_uteis = set((await db.execute(
            select(CalendarioAcademico.data).where(
                CalendarioAcademico.letivo == False,  # noqa: E712
                CalendarioAcademico.tipo.in_(tipos),
                CalendarioAcademico.data >= ini, CalendarioAcademico.data <= fim,
            )
        )).scalars().all())
    return Calendario(dias_semana(cfg), nao_uteis)


def rateio_apontamento(ap: NrApontamento, cal: Calendario) -> dict[date, float]:
    """Distribui as horas do lançamento pelos dias úteis do período (todos os dias, se não houver útil)."""
    dias = cal.dias_uteis(ap.data_inicio, ap.data_fim) or list(_datas(ap.data_inicio, ap.data_fim))
    if not dias:
        return {}
    parte = ap.horas / len(dias)
    return {d: parte for d in dias}


def fim_efetivo_vinculo(v: NrVinculo) -> Optional[date]:
    """Último dia em que o vínculo conta: o menor entre o fim do vínculo e a conclusão do projeto."""
    candidatos = [d for d in (v.data_fim, v.projeto.data_conclusao if v.projeto else None) if d]
    return min(candidatos) if candidatos else None


def horas_semanais_em(v, d: date) -> float:
    """Carga semanal vigente no dia: faixa por período, se houver; senão a padrão do vínculo."""
    for p in getattr(v, "periodos", None) or []:
        if p.data_inicio <= d and (p.data_fim is None or d <= p.data_fim):
            return p.horas_semanais
    return v.horas_semanais


def vigente(ini: date, fim: Optional[date], d: date) -> bool:
    return ini <= d and (fim is None or d <= fim)


# ── Cálculo de carga ──────────────────────────────────────────────────────────

@dataclass
class Filtros:
    professor_id: Optional[int] = None
    unidade: Optional[str] = None
    categoria_id: Optional[int] = None
    projeto_id: Optional[int] = None
    responsavel_id: Optional[int] = None
    situacao: Optional[str] = None

    @property
    def filtra_projeto(self) -> bool:
        return any(v not in (None, "") for v in (self.unidade, self.categoria_id, self.projeto_id,
                                                 self.responsavel_id, self.situacao))

    def descricao(self) -> list[str]:
        partes = []
        if self.unidade:
            partes.append(f"Unidade/setor: {self.unidade}")
        if self.situacao:
            partes.append(f"Situação do projeto: {SITUACAO_PROJETO.get(self.situacao, self.situacao)}")
        return partes


@dataclass
class Escopo:
    """O que o usuário pode ver: tudo (gestão), os projetos que coordena e/ou os próprios vínculos."""
    tudo: bool
    projeto_ids: set[int] = field(default_factory=set)
    coordena: set[int] = field(default_factory=set)   # projetos em que o usuário é o responsável
    professor_id: Optional[int] = None


async def escopo_do_usuario(db: AsyncSession, user: Usuario) -> Escopo:
    if eh_gestao(user):
        return Escopo(tudo=True)
    prof = await professor_do_usuario(db, user)
    coordena = set((await db.execute(select(NrProjeto.id).where(NrProjeto.responsavel_id == user.id))).scalars().all())
    ids = set(coordena)
    if prof:
        ids |= set((await db.execute(
            select(NrVinculo.projeto_id).where(NrVinculo.professor_id == prof.id)
        )).scalars().all())
    return Escopo(tudo=False, projeto_ids=ids, coordena=coordena, professor_id=prof.id if prof else None)


def _projeto_passa(p: NrProjeto, f: Filtros, esc: Escopo) -> bool:
    if not esc.tudo and p.id not in esc.projeto_ids:
        return False
    if f.projeto_id and p.id != f.projeto_id:
        return False
    if f.categoria_id and p.categoria_id != f.categoria_id:
        return False
    if f.unidade and (p.unidade or "").strip().lower() != f.unidade.strip().lower():
        return False
    if f.responsavel_id and p.responsavel_id != f.responsavel_id:
        return False
    if f.situacao and p.situacao != f.situacao:
        return False
    return True


async def _horas_aulas(db: AsyncSession, ids: list[int], ini: date, fim: date) -> tuple[dict, dict, dict]:
    """Regência prevista (Agendada+Realizada) e realizada por professor, por dia — slot contado uma vez."""
    prevista: dict[int, float] = defaultdict(float)
    realizada: dict[int, float] = defaultdict(float)
    por_dia: dict[int, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    if not ids:
        return prevista, realizada, por_dia
    aulas = (await db.execute(
        select(Aula).where(Aula.professor_id.in_(ids), Aula.status.in_(["Realizada", "Agendada"]),
                           Aula.data >= ini, Aula.data <= fim)
    )).scalars().all()
    slots: dict[tuple, Aula] = {}
    slots_real: dict[tuple, Aula] = {}
    for a in aulas:
        chave = (a.professor_id, a.data, a.horario_inicio, a.horario_fim)
        slots.setdefault(chave, a)
        if a.status == "Realizada":
            slots_real.setdefault(chave, a)
    for (pid, d, _, _), a in slots.items():
        h = _horas_aula(a)
        prevista[pid] += h
        por_dia[pid][d] += h
    for (pid, _, _, _), a in slots_real.items():
        realizada[pid] += _horas_aula(a)
    return prevista, realizada, por_dia


def indicador_regencia(prof: Professor, horas_ministradas: float, ini: date, fim: date) -> dict:
    """Mesma fórmula da aba Regência (services/regencia.py), sem nenhuma hora de projeto."""
    horas_periodo = prof.horas_contratadas * _semanas_uteis(ini, fim)
    if prof.tipo in _TIPOS_MENSALISTA:
        pct = horas_ministradas / horas_periodo if horas_periodo > 0 else 0
    else:
        pct = min(1.0, horas_ministradas / horas_periodo) if horas_periodo > 0 else 0
    return {"percentual": round(pct * 100, 1), "status": calcular_status_regencia(pct, prof.tipo)}


def r(v: float) -> float:
    return round(v + 0.0, 2)


async def calcular(db: AsyncSession, ini: date, fim: date, f: Filtros, esc: Escopo,
                   incluir_todos_professores: bool = True) -> dict:
    """Consolida carga, horas e entregas do período. Base do dashboard, dos relatórios e das consultas."""
    cfg = await config(db)
    cal = await calendario(db, cfg, ini, fim)
    hoje = hoje_br()

    projetos = (await db.execute(
        select(NrProjeto).options(selectinload(NrProjeto.categoria), selectinload(NrProjeto.responsavel),
                                  selectinload(NrProjeto.entregas))
        .execution_options(populate_existing=True)
    )).scalars().all()
    proj_ok = {p.id: p for p in projetos if _projeto_passa(p, f, esc)}

    vinculos = (await db.execute(
        select(NrVinculo).options(selectinload(NrVinculo.periodos),
                                  selectinload(NrVinculo.projeto).selectinload(NrProjeto.entregas),
                                  selectinload(NrVinculo.professor))
        .where(NrVinculo.projeto_id.in_(list(proj_ok) or [0])).execution_options(populate_existing=True)
    )).scalars().all()
    if not esc.tudo:
        # Fora da gestão: a equipe inteira só nos projetos que coordena; nos demais, os próprios vínculos
        vinculos = [v for v in vinculos if v.projeto_id in esc.coordena or v.professor_id == esc.professor_id]
    if f.professor_id:
        vinculos = [v for v in vinculos if v.professor_id == f.professor_id]

    aps = (await db.execute(
        select(NrApontamento).where(
            NrApontamento.projeto_id.in_(list(proj_ok) or [0]),
            NrApontamento.data_inicio <= fim, NrApontamento.data_fim >= ini,
        )
    )).scalars().all()
    if f.professor_id:
        aps = [a for a in aps if a.professor_id == f.professor_id]
    if not esc.tudo:
        aps = [a for a in aps if a.projeto_id in esc.coordena or a.professor_id == esc.professor_id]

    # Professores do relatório
    q = select(Professor).where(Professor.ativo == True)  # noqa: E712
    if f.professor_id:
        q = select(Professor).where(Professor.id == f.professor_id)
    profs = (await db.execute(q)).scalars().all()
    com_projeto = {v.professor_id for v in vinculos} | {a.professor_id for a in aps}
    if f.filtra_projeto or not incluir_todos_professores:
        profs = [p for p in profs if p.id in com_projeto]
    if not esc.tudo:
        profs = [p for p in profs if p.id in com_projeto or p.id == esc.professor_id]
    ids = [p.id for p in profs]

    afast = (await db.execute(
        select(NrAfastamento).where(NrAfastamento.professor_id.in_(ids or [0]),
                                    NrAfastamento.data_inicio <= fim, NrAfastamento.data_fim >= ini)
    )).scalars().all()
    dias_afast: dict[int, set[date]] = defaultdict(set)
    for a in afast:
        for d in _datas(max(a.data_inicio, ini), min(a.data_fim, fim)):
            dias_afast[a.professor_id].add(d)

    outras = (await db.execute(
        select(NrOutraAlocacao).where(NrOutraAlocacao.professor_id.in_(ids or [0]),
                                      NrOutraAlocacao.data_inicio <= fim,
                                      or_(NrOutraAlocacao.data_fim == None, NrOutraAlocacao.data_fim >= ini))  # noqa: E711
    )).scalars().all()

    reg_prev, reg_real, _ = await _horas_aulas(db, ids, ini, fim)
    uteis = cal.dias_uteis(ini, fim)
    dps = cal.dias_por_semana
    reserva_pct = num(cfg, "reserva_planejamento_pct") / 100

    # Não regência prevista por vínculo (dia a dia)
    prev_vinc: dict[int, float] = {}
    for v in vinculos:
        fim_v = fim_efetivo_vinculo(v)
        total = 0.0
        for d in uteis:
            if vigente(v.data_inicio, fim_v, d) and d not in dias_afast.get(v.professor_id, ()):
                total += horas_semanais_em(v, d) / dps
        prev_vinc[v.id] = total

    # Horas informadas/validadas no período (rateadas)
    inf_ap: dict[int, float] = {}
    por_mes_validadas: dict[str, float] = defaultdict(float)
    por_mes_informadas: dict[str, float] = defaultdict(float)
    for a in aps:
        parte = sum(h for d, h in rateio_apontamento(a, cal).items() if ini <= d <= fim)
        inf_ap[a.id] = parte
        for d, h in rateio_apontamento(a, cal).items():
            if ini <= d <= fim and a.situacao != "rascunho":
                por_mes_informadas[d.strftime("%Y-%m")] += h
                if a.situacao == "aprovado":
                    por_mes_validadas[d.strftime("%Y-%m")] += h

    linhas = []
    for p in sorted(profs, key=lambda x: x.nome):
        meus_dias = uteis
        diario = p.horas_contratadas / dps
        contratual = diario * len(meus_dias)
        indisp = diario * sum(1 for d in meus_dias if d in dias_afast.get(p.id, ()))
        disponivel = contratual - indisp
        reserva = disponivel * reserva_pct
        oficiais = [v for v in vinculos if v.professor_id == p.id and v.situacao in VINCULO_OFICIAL]
        propostas = [v for v in vinculos if v.professor_id == p.id and v.situacao == "proposta"]
        nr_prev = sum(prev_vinc[v.id] for v in oficiais)
        nr_prop = sum(prev_vinc[v.id] for v in propostas)
        outras_h = 0.0
        for o in outras:
            if o.professor_id != p.id:
                continue
            for d in meus_dias:
                if vigente(o.data_inicio, o.data_fim, d) and d not in dias_afast.get(p.id, ()):
                    outras_h += o.horas_semanais / dps
        meus_aps = [a for a in aps if a.professor_id == p.id]
        informadas = sum(inf_ap[a.id] for a in meus_aps if a.situacao != "rascunho")
        validadas = sum(inf_ap[a.id] for a in meus_aps if a.situacao == "aprovado")
        pendentes = sum(inf_ap[a.id] for a in meus_aps if a.situacao == "enviado")
        saldo = disponivel - reserva - reg_prev.get(p.id, 0) - nr_prev - outras_h
        ind = indicador_regencia(p, reg_prev.get(p.id, 0), ini, fim)
        atrasadas = 0
        for pr in proj_ok.values():
            for e in pr.entregas:
                if p.id in (e.responsaveis or []) and e.prazo and e.prazo < hoje and e.situacao != "aprovada":
                    atrasadas += 1
        linhas.append({
            "professor_id": p.id, "nome": p.nome, "foto": p.foto, "tipo": p.tipo, "area": p.area,
            "horas_semanais_contrato": p.horas_contratadas,
            "dias_uteis": len(meus_dias),
            "dias_afastado": sum(1 for d in meus_dias if d in dias_afast.get(p.id, ())),
            "carga_contratual": r(contratual), "indisponivel": r(indisp), "disponivel": r(disponivel),
            "reserva_planejamento": r(reserva),
            "regencia_prevista": r(reg_prev.get(p.id, 0)), "regencia_realizada": r(reg_real.get(p.id, 0)),
            "regencia_pct": ind["percentual"], "regencia_status": ind["status"],
            "nr_prevista": r(nr_prev), "nr_proposta": r(nr_prop),
            "nr_informada": r(informadas), "nr_validada": r(validadas), "nr_pendente": r(pendentes),
            "outras_alocacoes": r(outras_h), "saldo_previsto": r(saldo),
            "sobrecarga": saldo < -num(cfg, "tolerancia_sobrecarga_h"),
            "entregas_atrasadas": atrasadas, "projetos": len({v.projeto_id for v in oficiais + propostas}),
        })

    # Por projeto e por categoria
    por_proj: dict[int, dict] = {}
    for pid, pr in proj_ok.items():
        vs = [v for v in vinculos if v.projeto_id == pid]
        ap_p = [a for a in aps if a.projeto_id == pid]
        por_proj[pid] = {
            "projeto_id": pid, "codigo": pr.codigo, "nome": pr.nome, "situacao": pr.situacao,
            "categoria": pr.categoria.nome if pr.categoria else "Sem categoria",
            "previstas": r(sum(prev_vinc[v.id] for v in vs if v.situacao in VINCULO_OFICIAL)),
            "propostas": r(sum(prev_vinc[v.id] for v in vs if v.situacao == "proposta")),
            "informadas": r(sum(inf_ap[a.id] for a in ap_p if a.situacao != "rascunho")),
            "validadas": r(sum(inf_ap[a.id] for a in ap_p if a.situacao == "aprovado")),
            "professores": len({v.professor_id for v in vs if v.situacao in VINCULO_OFICIAL | {"proposta"}}),
            "progresso": progresso(pr.entregas),
        }
    por_cat: dict[str, dict] = defaultdict(lambda: {"previstas": 0.0, "informadas": 0.0, "validadas": 0.0})
    for x in por_proj.values():
        c = por_cat[x["categoria"]]
        for k in ("previstas", "informadas", "validadas"):
            c[k] += x[k]

    # Entregas do período
    entregas = [e for pr in proj_ok.values() for e in pr.entregas]
    if f.professor_id:
        entregas = [e for e in entregas if f.professor_id in (e.responsaveis or [])]
    no_periodo = [e for e in entregas if e.prazo and ini <= e.prazo <= fim]
    atrasadas = [e for e in entregas if e.prazo and e.prazo < hoje and e.situacao != "aprovada"]
    projetos_atrasados = []
    for pr in proj_ok.values():
        vencido = (pr.situacao not in PROJETO_ENCERRADO and not pr.continuo and pr.data_fim_prevista
                   and pr.data_fim_prevista < hoje)
        n_atr = sum(1 for e in atrasadas if e.projeto_id == pr.id)
        if vencido or n_atr:
            projetos_atrasados.append({
                "projeto_id": pr.id, "codigo": pr.codigo, "nome": pr.nome, "situacao": pr.situacao,
                "data_fim_prevista": pr.data_fim_prevista.isoformat() if pr.data_fim_prevista else None,
                "prazo_vencido": bool(vencido), "entregas_atrasadas": n_atr,
            })

    meses = sorted({d.strftime("%Y-%m") for d in _datas(ini, fim)})
    return {
        "cfg": cfg, "cal": cal, "projetos": proj_ok, "vinculos": vinculos, "apontamentos": aps,
        "prev_vinc": prev_vinc, "inf_ap": inf_ap, "linhas": linhas, "por_projeto": list(por_proj.values()),
        "por_categoria": [{"categoria": k, **{kk: r(vv) for kk, vv in v.items()}} for k, v in sorted(por_cat.items())],
        "evolucao": [{"mes": m, "informadas": r(por_mes_informadas.get(m, 0)), "validadas": r(por_mes_validadas.get(m, 0))}
                     for m in meses],
        "entregas_periodo": no_periodo, "entregas_atrasadas": atrasadas, "projetos_atrasados": projetos_atrasados,
    }


def progresso(entregas: list[NrEntrega]) -> Optional[float]:
    """% concluído pelas entregas aprovadas e seus pesos (peso vazio = 1). Sem entregas: não definido."""
    if not entregas:
        return None
    total = sum((e.peso if e.peso and e.peso > 0 else 1) for e in entregas)
    feito = sum((e.peso if e.peso and e.peso > 0 else 1) for e in entregas if e.situacao == "aprovada")
    return round(feito / total * 100, 1) if total else None


async def disponibilidade(db: AsyncSession, professor_ids: list[int], ini: date, fim: date,
                          horas_semanais: float = 0, excluir_vinculo_id: Optional[int] = None,
                          horas_por: Optional[dict[int, float]] = None) -> list[dict]:
    """Saldo de cada professor no período antes e depois de uma nova alocação semanal (para decidir a aprovação)."""
    res = await calcular(db, ini, fim, Filtros(), Escopo(tudo=True))
    cal: Calendario = res["cal"]
    linhas = {l["professor_id"]: l for l in res["linhas"]}
    faltantes = [i for i in professor_ids if i not in linhas]
    if faltantes:  # professor inativo: calcula só ele
        for pid in faltantes:
            extra = await calcular(db, ini, fim, Filtros(professor_id=pid), Escopo(tudo=True))
            linhas.update({l["professor_id"]: l for l in extra["linhas"]})
    excluir = 0.0
    saida = []
    for pid in professor_ids:
        l = linhas.get(pid)
        if not l:
            continue
        if excluir_vinculo_id:
            v = next((v for v in res["vinculos"] if v.id == excluir_vinculo_id and v.professor_id == pid), None)
            excluir = res["prev_vinc"].get(v.id, 0) if v and v.situacao in VINCULO_OFICIAL else 0.0
        dias = [d for d in cal.dias_uteis(ini, fim)]
        livres = len(dias) - l["dias_afastado"]
        semanal = (horas_por or {}).get(pid, horas_semanais)
        nova = semanal / cal.dias_por_semana * max(0, livres)
        saldo_antes = l["saldo_previsto"] + excluir
        saida.append({
            **{k: l[k] for k in ("professor_id", "nome", "foto", "tipo", "disponivel", "reserva_planejamento",
                                 "regencia_prevista", "nr_prevista", "nr_proposta", "outras_alocacoes",
                                 "dias_afastado", "regencia_pct")},
            "saldo_antes": r(saldo_antes), "horas_novas": r(nova), "saldo_depois": r(saldo_antes - nova),
            "sobrecarga_depois": saldo_antes - nova < -num(res["cfg"], "tolerancia_sobrecarga_h"),
        })
    return saida


# ── Alertas ───────────────────────────────────────────────────────────────────

async def alertas(db: AsyncSession, res: dict, ini: date, fim: date) -> list[dict]:
    cfg = res["cfg"]
    hoje = hoje_br()
    out: list[dict] = []

    def add(tipo, nivel, msg, **ref):
        out.append({"tipo": tipo, "nivel": nivel, "mensagem": msg, **ref})

    lim_reg = num(cfg, "limite_regencia_pct")
    saldo_min = num(cfg, "saldo_minimo_alerta_h")
    for l in res["linhas"]:
        if l["sobrecarga"]:
            add("sobrecarga", "alto",
                f"{l['nome']}: carga prevista excede a disponível em {abs(l['saldo_previsto']):.1f}h no período "
                f"(regência {l['regencia_prevista']:.1f}h + não regência {l['nr_prevista']:.1f}h + outras "
                f"{l['outras_alocacoes']:.1f}h para {l['disponivel']:.1f}h disponíveis).", professor_id=l["professor_id"])
        elif l["regencia_pct"] < lim_reg and l["saldo_previsto"] >= saldo_min and l["disponivel"] > 0:
            add("regencia_baixa_saldo", "medio",
                f"{l['nome']}: regência de {l['regencia_pct']:.0f}% (parâmetro {lim_reg:.0f}%) e "
                f"{l['saldo_previsto']:.1f}h sem alocação registrada no período. Vale analisar a distribuição da carga.",
                professor_id=l["professor_id"])

    projetos: dict[int, NrProjeto] = res["projetos"]
    for v in res["vinculos"]:
        if v.situacao not in {"proposta", "aprovada"}:
            continue
        pr = projetos.get(v.projeto_id)
        tem_entrega = pr and any(v.professor_id in (e.responsaveis or []) for e in pr.entregas)
        if not tem_entrega and not (v.responsabilidades or "").strip():
            add("vinculo_sem_entregas", "medio",
                f"{v.professor.nome if v.professor else 'Professor'} em {pr.nome if pr else 'projeto'}: vínculo sem "
                "entregas ou responsabilidades definidas.", projeto_id=v.projeto_id, professor_id=v.professor_id)

    for pr in projetos.values():
        if pr.situacao in PROJETO_ENCERRADO:
            futuros = [v for v in res["vinculos"] if v.projeto_id == pr.id and v.situacao == "aprovada"
                       and (v.data_fim is None or v.data_fim > (pr.data_conclusao or hoje))]
            if futuros:
                add("encerrado_com_alocacao", "alto",
                    f"{pr.codigo} {pr.nome}: projeto {SITUACAO_PROJETO[pr.situacao].lower()} com {len(futuros)} "
                    "alocação(ões) aprovada(s) ainda ativa(s). Encerre os vínculos.", projeto_id=pr.id)
            continue
        if pr.continuo and pr.data_revisao and pr.data_revisao < hoje:
            add("revisao_vencida", "medio",
                f"{pr.codigo} {pr.nome}: revisão da alocação venceu em {pr.data_revisao.strftime('%d/%m/%Y')}.",
                projeto_id=pr.id)

    andamento = [p.id for p in projetos.values() if p.situacao == "em_andamento"]
    if andamento:
        ultimos = dict((await db.execute(
            select(NrHistorico.projeto_id, func.max(NrHistorico.criado_em))
            .where(NrHistorico.projeto_id.in_(andamento)).group_by(NrHistorico.projeto_id)
        )).all())
        limite = int(num(cfg, "dias_sem_movimentacao"))
        for pid in andamento:
            ult = ultimos.get(pid)
            if ult is not None:
                ult_d = (ult if ult.tzinfo else ult.replace(tzinfo=timezone.utc)).astimezone(FUSO_BR).date()
                if (hoje - ult_d).days > limite:
                    pr = projetos[pid]
                    add("sem_movimentacao", "baixo",
                        f"{pr.codigo} {pr.nome}: sem movimentação há {(hoje - ult_d).days} dias.", projeto_id=pid)

    for e in res["entregas_atrasadas"]:
        pr = projetos.get(e.projeto_id)
        add("entrega_atrasada", "alto",
            f"Entrega \"{e.titulo}\" ({pr.nome if pr else ''}) com prazo em {e.prazo.strftime('%d/%m/%Y')} "
            f"está {SITUACAO_ENTREGA.get(e.situacao, e.situacao).lower()}.", projeto_id=e.projeto_id, entrega_id=e.id)

    dias_val = int(num(cfg, "dias_validacao_pendente"))
    antigos = [a for a in res["apontamentos"] if a.situacao == "enviado" and a.enviado_em
               and (agora() - (a.enviado_em if a.enviado_em.tzinfo else a.enviado_em.replace(tzinfo=timezone.utc))).days >= dias_val]
    if antigos:
        add("validacao_pendente", "medio",
            f"{len(antigos)} apontamento(s) com {sum(a.horas for a in antigos):.1f}h aguardando validação há "
            f"{dias_val} dias ou mais.")

    tol = num(cfg, "tolerancia_apontamento_pct") / 100
    informado_vinc: dict[tuple, float] = defaultdict(float)
    for a in res["apontamentos"]:
        if a.situacao != "rascunho":
            informado_vinc[(a.projeto_id, a.professor_id)] += res["inf_ap"].get(a.id, 0)
    for (pid, prof_id), h in informado_vinc.items():
        previsto = sum(res["prev_vinc"].get(v.id, 0) for v in res["vinculos"]
                       if v.projeto_id == pid and v.professor_id == prof_id and v.situacao in VINCULO_OFICIAL)
        if h > previsto * (1 + tol) + 0.01:
            nome = next((v.professor.nome for v in res["vinculos"] if v.professor_id == prof_id and v.professor), "Professor")
            pr = projetos.get(pid)
            add("apontamento_acima_previsto", "medio",
                f"{nome} informou {h:.1f}h em {pr.nome if pr else 'projeto'} no período, acima das {previsto:.1f}h "
                "previstas.", projeto_id=pid, professor_id=prof_id)

    ordem = {"alto": 0, "medio": 1, "baixo": 2}
    return sorted(out, key=lambda x: ordem[x["nivel"]])


async def conflitos_apontamento(db: AsyncSession, ap: NrApontamento, ignorar_id: Optional[int] = None) -> dict:
    """Duplicidade (lançamento que cobre os mesmos dias no mesmo projeto) e sinais de incompatibilidade."""
    q = select(NrApontamento).where(
        NrApontamento.professor_id == ap.professor_id, NrApontamento.projeto_id == ap.projeto_id,
        NrApontamento.data_inicio <= ap.data_fim, NrApontamento.data_fim >= ap.data_inicio,
    )
    if ignorar_id:
        q = q.where(NrApontamento.id != ignorar_id)
    duplicados = (await db.execute(q)).scalars().all()

    cfg = await config(db)
    cal = await calendario(db, cfg, ap.data_inicio, ap.data_fim)
    avisos: list[str] = []
    afast = (await db.execute(
        select(NrAfastamento).where(NrAfastamento.professor_id == ap.professor_id,
                                    NrAfastamento.data_inicio <= ap.data_fim, NrAfastamento.data_fim >= ap.data_inicio)
    )).scalars().all()
    if afast:
        avisos.append("O período coincide com afastamento registrado: " +
                      ", ".join(f"{a.tipo} ({a.data_inicio.strftime('%d/%m')}–{a.data_fim.strftime('%d/%m')})" for a in afast) + ".")
    prof = await db.get(Professor, ap.professor_id)
    if prof:
        uteis = cal.dias_uteis(ap.data_inicio, ap.data_fim)
        cap = prof.horas_contratadas / cal.dias_por_semana * len(uteis)
        _, _, aulas_dia = await _horas_aulas(db, [prof.id], ap.data_inicio, ap.data_fim)
        aulas = sum(aulas_dia.get(prof.id, {}).values())
        if not uteis:
            avisos.append("O período não tem dias de trabalho no calendário (fim de semana ou feriado).")
        elif ap.horas + aulas > cap + 0.01:
            avisos.append(f"{ap.horas:.1f}h informadas + {aulas:.1f}h de aula superam a carga do período "
                          f"({cap:.1f}h).")
    return {"duplicados": duplicados, "avisos": avisos}
