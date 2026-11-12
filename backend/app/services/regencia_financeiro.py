"""
Impacto financeiro da regência — professores do quadro (Mensalista e Horista), mês a mês.

Mesma base do gráfico geral da aba Regência:
- Real: horas do diário ÷ horas do ponto (a capacidade é o tempo efetivamente pago/batido).
- Aulas realizadas: horas das aulas com status Realizada (slot contado uma vez) ÷ carga contratada × semanas
  úteis. Só a produção efetiva conta: aulas agendadas ficam de fora.
As horas em sala de cada professor são limitadas à capacidade do mês (o excedente do horista é pago à parte e
não é economia). Não usa dados da Não Regência.

Por professor e mês (valor da hora = média informada; a estrutura aceita valor por professor no futuro):
- Oportunidade = max(0, meta × capacidade − horas em sala) × valor da hora — capacidade paga que ainda pode
  ir para a sala até a meta (70% mensalista, 100% horista, as mesmas metas da aba Regência).
- Ganho do mês = (horas em sala − regência do mês anterior × capacidade do mês) × valor da hora — horas a
  mais (ou a menos) do que haveria se a regência do mês anterior tivesse se mantido. Comparar pela taxa, e não
  pelas horas brutas, neutraliza meses com mais ou menos dias úteis. Professor sem dados no mês anterior não
  entra no ganho daquele mês (entra na oportunidade).
"""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, timedelta
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
    """(horas em sala, capacidade) por (professor, mês): só aulas realizadas, sobre a carga contratada."""
    aulas = (await db.execute(select(Aula).where(
        Aula.status == "Realizada", Aula.data >= ini, Aula.data <= fim,
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
                   fonte: str = "auto", mes: Optional[str] = None,
                   area: Optional[str] = None, modalidade: Optional[str] = None) -> dict:
    """Cada mês comparado com o mês anterior. `mes` = mês analisado nos cartões (padrão: o último)."""
    profs = await _professores(db, area, modalidade)
    # Carrega também o mês anterior ao período: o primeiro mês precisa de referência
    ini_ref = (ini.replace(day=1) - timedelta(days=1)).replace(day=1)
    meses = meses_do_periodo(ini_ref, fim, hoje)
    real = await _base_real(db, profs, meses, ini_ref, fim) if fonte in ("auto", "real") else {}
    meses_com_real = {k for (_, k) in real}
    if fonte == "auto":
        fonte = "real" if len(meses_com_real) >= 2 else "planejada"
    base = real if fonte == "real" else await _base_planejada(db, profs, meses, ini_ref, fim)
    todas = [k for k, _, _ in meses if fonte == "planejada" or k in meses_com_real]
    ref = f"{ini_ref.year}-{ini_ref.month:02d}"
    chaves = [k for k in todas if k != ref]
    mes = mes if mes in chaves else (chaves[-1] if chaves else None)

    def valor(_pid: int) -> float:  # ponto único para o valor por professor no futuro
        return valor_hora

    def taxa(pid: int, k: Optional[str]) -> Optional[float]:
        h, cap = base.get((pid, k), (0.0, 0.0)) if k else (0.0, 0.0)
        return min(h, cap) / cap if cap > 0 else None

    linhas_mes = []
    por_prof: dict[tuple[int, str], dict] = {}
    for idx, k in enumerate(chaves):
        anterior = todas[todas.index(k) - 1] if todas.index(k) > 0 else None
        h_tot = cap_tot = falt = opp = ganho_h = ganho_r = h_ant = cap_ant = 0.0
        n = 0
        for pid, p in profs.items():
            h, cap = base.get((pid, k), (0.0, 0.0))
            if cap <= 0:
                continue
            n += 1
            h = min(h, cap)
            f = max(0.0, _meta(p.tipo) * cap - h)
            t_ant = taxa(pid, anterior)
            g = (h - t_ant * cap) if t_ant is not None else None
            h_tot += h
            cap_tot += cap
            falt += f
            opp += f * valor(pid)
            if g is not None:
                ganho_h += g
                ganho_r += g * valor(pid)
                ha, ca = base.get((pid, anterior))
                h_ant += min(ha, ca)
                cap_ant += ca
            por_prof[(pid, k)] = {
                "professor_id": pid, "nome": p.nome, "tipo": p.tipo, "area": p.area,
                "regencia_anterior": round(t_ant * 100, 1) if t_ant is not None else None,
                "regencia": round(h / cap * 100, 1), "meta": round(_meta(p.tipo) * 100),
                "ganho_horas": round(g, 1) if g is not None else None,
                "ganho_reais": round(g * valor(pid), 2) if g is not None else None,
                "faltante_horas": round(f, 1), "oportunidade_reais": round(f * valor(pid), 2),
            }
        linhas_mes.append({
            "mes": k, "mes_anterior": anterior, "n_professores": n,
            "horas_sala": round(h_tot, 1), "capacidade": round(cap_tot, 1),
            "regencia_pct": round(h_tot / cap_tot * 100, 1) if cap_tot else 0.0,
            "regencia_anterior_pct": round(h_ant / cap_ant * 100, 1) if cap_ant else None,
            "faltante_horas": round(falt, 1), "oportunidade_reais": round(opp, 2),
            "ganho_horas": round(ganho_h, 1) if anterior else None,
            "ganho_reais": round(ganho_r, 2) if anterior else None,
        })

    m = next((x for x in linhas_mes if x["mes"] == mes), None)
    professores = sorted((v for (pid, k), v in por_prof.items() if k == mes),
                         key=lambda x: -(x["ganho_reais"] if x["ganho_reais"] is not None else -1e12))
    com_ganho = [x for x in linhas_mes if x["ganho_reais"] is not None]
    return {
        "fonte": fonte, "valor_hora": valor_hora, "mes": mes, "meses": linhas_mes, "meses_disponiveis": chaves,
        "professores": professores,
        "resumo": {
            "mes": mes, "mes_anterior": m["mes_anterior"] if m else None,
            "regencia_anterior": m["regencia_anterior_pct"] if m else None,
            "regencia": m["regencia_pct"] if m else None,
            "variacao_pp": round(m["regencia_pct"] - m["regencia_anterior_pct"], 1)
                           if m and m["regencia_anterior_pct"] is not None else None,
            "ganho_horas": m["ganho_horas"] if m else None,
            "ganho_reais": m["ganho_reais"] if m else None,
            "oportunidade_horas": m["faltante_horas"] if m else 0.0,
            "oportunidade_reais": m["oportunidade_reais"] if m else 0.0,
            "ganho_periodo_reais": round(sum(x["ganho_reais"] for x in com_ganho), 2),
            "ganho_periodo_horas": round(sum(x["ganho_horas"] for x in com_ganho), 1),
            "n_professores": m["n_professores"] if m else 0,
        },
    }
