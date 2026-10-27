"""Horas batidas por professor e mês, lidas da Gestão de Ponto (snapshot em gp_painel).

Substitui a planilha de ponto que era importada na Regência: soma o `workedMinutes` de cada dia
(o mesmo valor da coluna "Horas batidas no ponto" do Excel do Power BI) por colaborador e mês
civil, e liga o colaborador ao professor pelo nome (ou, se não bater, pelo e-mail).
"""
import calendar
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gestao_ponto import GpPainel
from app.models.professor import Professor

_PAINEL_ID = 1


def _norm_nome(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper().strip())


@dataclass
class PontoMes:
    """Mesmo formato do antigo PontoMensal (horas em decimal)."""
    id: str
    professor_id: int | None
    nome_colaborador: str
    data_inicio: date
    data_fim: date
    horas_total: float     # horas batidas no mês
    horas_extras: float    # batidas − previstas no mês
    horas_efetivas: float | None = None


@dataclass
class _Colaborador:
    matricula: str
    nome: str
    email: str
    meses: dict  # (ano, mês) -> [batidos_min, previstos_min]


# Cache do snapshot agregado (o JSON tem dezenas de MB): refeito só quando o painel muda
_cache: dict = {"chave": None, "colaboradores": [], "atualizado_em": None, "periodo": (None, None)}


def _agregar(dados: dict) -> tuple[list[_Colaborador], date | None, date | None]:
    dias = ((dados or {}).get("result") or {}).get("days") or []
    colabs: dict[str, _Colaborador] = {}
    batem_ponto: set[str] = set()
    primeiro = ultimo = None
    for d in dias:
        try:
            dia, mes, ano = (int(x) for x in str(d.get("date", "")).split("/"))
            data = date(ano, mes, dia)
        except ValueError:
            continue
        matricula = str(d.get("matricula") or "")
        if not matricula:
            continue
        if d.get("punches"):
            batem_ponto.add(matricula)
        c = colabs.get(matricula)
        if c is None:
            c = colabs[matricula] = _Colaborador(matricula, d.get("collaborator") or "", (d.get("email") or "").strip().lower(), {})
        acum = c.meses.setdefault((ano, mes), [0, 0])
        acum[0] += int(d.get("workedMinutes") or 0)
        acum[1] += int(d.get("expectedMinutes") or 0)
        primeiro = data if primeiro is None or data < primeiro else primeiro
        ultimo = data if ultimo is None or data > ultimo else ultimo
    # Como no painel mensal da Gestão de Ponto: só quem registra ponto
    return [c for m, c in colabs.items() if m in batem_ponto], primeiro, ultimo


async def _colaboradores(db: AsyncSession) -> list[_Colaborador]:
    meta = (await db.execute(
        select(GpPainel.updated_at, GpPainel.analysis_version).where(GpPainel.id == _PAINEL_ID)
    )).first()
    if not meta or not meta.updated_at:
        return []
    chave = (meta.updated_at, meta.analysis_version)
    if _cache["chave"] != chave:
        texto = (await db.execute(select(GpPainel.dados).where(GpPainel.id == _PAINEL_ID))).scalar()
        colabs, primeiro, ultimo = _agregar(json.loads(texto) if texto else {})
        _cache.update(chave=chave, colaboradores=colabs, atualizado_em=meta.updated_at, periodo=(primeiro, ultimo))
    return _cache["colaboradores"]


async def info(db: AsyncSession) -> dict:
    colabs = await _colaboradores(db)
    primeiro, ultimo = _cache["periodo"] if colabs else (None, None)
    atualizado: datetime | None = _cache["atualizado_em"] if colabs else None
    return {
        "fonte": "gestao_ponto",
        "total": sum(len(c.meses) for c in colabs),
        "colaboradores": len(colabs),
        "importado_em": atualizado.isoformat() if atualizado else None,
        "data_inicio": primeiro.isoformat() if primeiro else None,
        "data_fim": ultimo.isoformat() if ultimo else None,
    }


async def registros(db: AsyncSession, data_inicio: date, data_fim: date,
                    professor_ids: set[int] | None = None) -> list[PontoMes]:
    """Meses (civis) que se sobrepõem ao período, por professor vinculado."""
    colabs = await _colaboradores(db)
    if not colabs:
        return []
    profs = (await db.execute(select(Professor.id, Professor.nome, Professor.email))).all()
    por_nome = {_norm_nome(p.nome): p.id for p in profs}
    por_email = {(p.email or "").strip().lower(): p.id for p in profs if p.email}

    saida: list[PontoMes] = []
    for c in colabs:
        pid = por_nome.get(_norm_nome(c.nome)) or (por_email.get(c.email) if c.email else None)
        if pid is None or (professor_ids is not None and pid not in professor_ids):
            continue
        for (ano, mes), (batidos, previstos) in sorted(c.meses.items()):
            ini, fim = date(ano, mes, 1), date(ano, mes, calendar.monthrange(ano, mes)[1])
            if ini > data_fim or fim < data_inicio:
                continue
            saida.append(PontoMes(
                id=f"{c.matricula}-{ano}{mes:02d}", professor_id=pid, nome_colaborador=c.nome,
                data_inicio=ini, data_fim=fim, horas_total=batidos / 60, horas_extras=(batidos - previstos) / 60,
            ))
    return saida
