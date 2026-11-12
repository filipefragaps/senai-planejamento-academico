"""
Impacto financeiro da regência — professores do quadro (Mensalista e Horista), mês a mês.

Mesma base do gráfico geral da aba Regência:
- Real: horas do diário ÷ horas do ponto (a capacidade é o tempo efetivamente pago/batido).
- Planejada: horas de aula (agendadas + realizadas, slot contado uma vez) ÷ carga contratada × semanas úteis.
As horas em sala de cada professor são limitadas à capacidade do mês (o excedente do horista é pago à parte e
não é economia). Não usa dados da Não Regência.

Por professor e mês (valor da hora = média informada; a estrutura aceita valor por professor no futuro):
- Oportunidade = max(0, meta × capacidade − horas em sala) × valor da hora — capacidade paga que ainda pode
  ir para a sala até a meta (70% mensalista, 100% horista, as mesmas metas da aba Regência).
- Ganho com a melhoria = (horas em sala − regência do mês-base × capacidade do mês) × valor da hora — horas a
  mais (ou a menos) do que haveria se a regência do mês-base tivesse se mantido. Comparar pela taxa, e não
  pelas horas brutas, neutraliza meses com mais ou menos dias úteis. Professor sem dados no mês-base não entra
  no ganho (entra na oportunidade).
"""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.atuacao import Atuacao
from app.models.aula import Aula
from app.models.professor import Professor
from app.services.regencia import META_REGENCIA_MENSALISTA, _horas_aula, _semanas_uteis

QUADRO = ["Mensalista", "Horista"]


def _meta(tipo: str) -> float:
    return META_REGENCIA_MENSALISTA if tipo == "Mensalista" else 1.0


def meses_do_periodo(ini: date, fim: date, hoje: date) -> list[tuple[str, date, date]]:
    """Meses civis do período; descarta meses futuros e limita o mês atual a hoje (como o gráfico geral)."""
    saida = []
    y, m = ini.year, ini.month
    while (y, m) <= (fim.year, fim.month):
        m_ini = max(date(y, m, 1), ini)
        m_fim = min(date(y, m, calendar.monthrange(y, m)[1]), fim, hoje)
        if m_ini <= hoje:
            saida.append((f"{y}-{m:02d}", m_ini, m_fim))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return saida


async def _professores(db: AsyncSession, area: Optional[str], modalidade: Optional[str]) -> dict[int, Professor]:
    profs = {p.id: p for p in (await db.execute(
        select(Professor).where(Professor.ativo == True, Professor.tipo.in_(QUADRO))  # noqa: E712
    )).scalars().all() if (p.horas_contratadas or 0) > 0}
    if area:
        profs = {i: p for i, p in profs.items() if p.area == area}
    if modalidade:
        mods = [x.strip() for x in modalidade.split(",") if x.strip()]
        ids = set((await db.execute(select(Atuacao.professor_id).where(Atuacao.modalidade.in_(mods)))).scalars().all())
        profs = {i: p for i, p in profs.items() if i in ids}
    return profs


async def _base_planejada(db, profs, meses, ini, fim) -> dict[tuple[int, str], tuple[float, float]]:
    """(horas em sala, capacidade) por (professor, mês) a partir das aulas e da carga contratada."""
    aulas = (await db.execute(select(Aula).where(
        Aula.status.in_(["Realizada", "Agendada"]), Aula.data >= ini, Aula.data <= fim,
        Aula.professor_id.in_(list(profs) or [0]),
    ))).scalars().all()
    vistos: dict[tuple, set] = defaultdict(set)
    horas: dict[tuple, float] = defaultdict(float)
    limites = {k: (a, b) for k, a, b in meses}
    for a in aulas:
        k = f"{a.data.year}-{a.data.month:02d}"
        if k not in limites or not (limites[k][0] <= a.data <= limites[k][1]):
            continue
        slot = (a.data, a.horario_inicio, a.horario_fim)
        if slot not in vistos[(a.professor_id, k)]:
            vistos[(a.professor_id, k)].add(slot)
            horas[(a.professor_id, k)] += _horas_aula(a)
    saida = {}
    for k, m_ini, m_fim in meses:
        semanas = _semanas_uteis(m_ini, m_fim)
        for pid, p in profs.items():
            saida[(pid, k)] = (horas.get((pid, k), 0.0), p.horas_contratadas * semanas)
    return saida


async def _base_real(db, profs, meses, ini, fim) -> dict[tuple[int, str], tuple[float, float]]:
    """(horas do diário, horas do ponto) por (professor, mês) — mesma fórmula da Regência Real."""
    from app.api.v1.diario import horas_executadas
    from app.models.diario import DiarioAula
    from app.services import ponto_gestao

    if not meses:
        return {}
    ate = meses[-1][2]
    rows = (await db.execute(select(
        DiarioAula.professor_id, DiarioAula.data, DiarioAula.hora_inicio, DiarioAula.hora_termino, DiarioAula.qtde_horas,
    ).where(DiarioAula.professor_id.in_(list(profs) or [0]), DiarioAula.data >= ini, DiarioAula.data <= ate))).all()
    regs: dict[tuple, list] = defaultdict(list)
    for r in rows:
        regs[(r.professor_id, f"{r.data.year}-{r.data.month:02d}")].append(r)
    diario = {k: horas_executadas(v) for k, v in regs.items()}
    ponto: dict[tuple, float] = defaultdict(float)
    for r in await ponto_gestao.registros(db, ini, ate, set(profs)):
        ponto[(r.professor_id, f"{r.data_inicio.year}-{r.data_inicio.month:02d}")] += r.horas_total
    return {k: (diario.get(k, 0.0), cap) for k, cap in ponto.items() if cap > 0}


async def calcular(db: AsyncSession, ini: date, fim: date, valor_hora: float, hoje: date,
                   fonte: str = "auto", mes_base: Optional[str] = None,
                   area: Optional[str] = None, modalidade: Optional[str] = None) -> dict:
    profs = await _professores(db, area, modalidade)
    meses = meses_do_periodo(ini, fim, hoje)
    real = await _base_real(db, profs, meses, ini, fim) if fonte in ("auto", "real") else {}
    meses_com_real = {k for (_, k) in real}
    if fonte == "auto":
        fonte = "real" if len(meses_com_real) >= 2 or (len(meses) == 1 and meses_com_real) else "planejada"
    base = real if fonte == "real" else await _base_planejada(db, profs, meses, ini, fim)
    chaves = [k for k, _, _ in meses if fonte == "planejada" or k in meses_com_real]
    mes_base = mes_base if mes_base in chaves else (chaves[0] if chaves else None)

    def valor(_pid: int) -> float:  # ponto único para o valor por professor no futuro
        return valor_hora

    # taxa de regência de cada professor no mês-base
    taxa_base = {}
    for pid in profs:
        h, cap = base.get((pid, mes_base), (0.0, 0.0))
        if cap > 0:
            taxa_base[pid] = min(h, cap) / cap

    linhas_mes = []
    por_prof: dict[int, dict] = defaultdict(lambda: {"ganho_horas": 0.0, "ganho_reais": 0.0, "faltante_horas": 0.0,
                                                    "oportunidade_reais": 0.0, "horas_sala": 0.0, "capacidade": 0.0})
    ultimo_taxa: dict[int, float] = {}
    for k in chaves:
        h_tot = cap_tot = falt = opp = ganho_h = ganho_r = 0.0
        percentuais = []
        n = 0
        for pid, p in profs.items():
            h, cap = base.get((pid, k), (0.0, 0.0))
            if cap <= 0:
                continue
            n += 1
            h = min(h, cap)
            pr = por_prof[pid]
            percentuais.append(h / cap * 100)
            ultimo_taxa[pid] = h / cap
            f = max(0.0, _meta(p.tipo) * cap - h)
            h_tot += h
            cap_tot += cap
            falt += f
            opp += f * valor(pid)
            pr["faltante_horas"] += f
            pr["oportunidade_reais"] += f * valor(pid)
            pr["horas_sala"] += h
            pr["capacidade"] += cap
            if k > mes_base and pid in taxa_base:
                g = h - taxa_base[pid] * cap
                ganho_h += g
                ganho_r += g * valor(pid)
                pr["ganho_horas"] += g
                pr["ganho_reais"] += g * valor(pid)
        linhas_mes.append({
            "mes": k, "base": k == mes_base, "n_professores": n,
            "horas_sala": round(h_tot, 1), "capacidade": round(cap_tot, 1),
            "regencia_pct": round(h_tot / cap_tot * 100, 1) if cap_tot else 0.0,
            "media_percentual": round(sum(percentuais) / len(percentuais), 1) if percentuais else 0.0,
            "faltante_horas": round(falt, 1), "oportunidade_reais": round(opp, 2),
            "ganho_horas": round(ganho_h, 1) if k > mes_base else None,
            "ganho_reais": round(ganho_r, 2) if k > mes_base else None,
        })

    professores = []
    for pid, d in por_prof.items():
        p = profs[pid]
        professores.append({
            "professor_id": pid, "nome": p.nome, "tipo": p.tipo, "area": p.area, "foto": p.foto,
            "regencia_base": round(taxa_base[pid] * 100, 1) if pid in taxa_base else None,
            "regencia_ultimo": round(ultimo_taxa[pid] * 100, 1) if pid in ultimo_taxa else None,
            "regencia_periodo": round(d["horas_sala"] / d["capacidade"] * 100, 1) if d["capacidade"] else 0.0,
            "meta": round(_meta(p.tipo) * 100),
            "ganho_horas": round(d["ganho_horas"], 1), "ganho_reais": round(d["ganho_reais"], 2),
            "faltante_horas": round(d["faltante_horas"], 1), "oportunidade_reais": round(d["oportunidade_reais"], 2),
        })
    professores.sort(key=lambda x: -x["ganho_reais"])

    depois = [m for m in linhas_mes if not m["base"] and m["ganho_reais"] is not None]
    b = next((m for m in linhas_mes if m["base"]), None)
    u = linhas_mes[-1] if linhas_mes else None
    return {
        "fonte": fonte, "valor_hora": valor_hora, "mes_base": mes_base, "meses": linhas_mes,
        "meses_disponiveis": chaves, "professores": professores,
        "resumo": {
            "regencia_base": b["regencia_pct"] if b else None,
            "regencia_ultimo": u["regencia_pct"] if u else None,
            "variacao_pp": round(u["regencia_pct"] - b["regencia_pct"], 1) if b and u else None,
            "ganho_horas": round(sum(m["ganho_horas"] for m in depois), 1),
            "ganho_reais": round(sum(m["ganho_reais"] for m in depois), 2),
            "oportunidade_ultimo_reais": u["oportunidade_reais"] if u else 0.0,
            "oportunidade_ultimo_horas": u["faltante_horas"] if u else 0.0,
            "oportunidade_media_reais": round(sum(m["oportunidade_reais"] for m in linhas_mes) / len(linhas_mes), 2) if linhas_mes else 0.0,
            "oportunidade_periodo_reais": round(sum(m["oportunidade_reais"] for m in linhas_mes), 2),
            "reducao_oportunidade_reais": round(b["oportunidade_reais"] - u["oportunidade_reais"], 2) if b and u and b is not u else 0.0,
            "n_professores": len(professores),
        },
    }
