"""
Impacto financeiro da regência — professores do quadro (Mensalista e Horista), mês a mês.

A regência é a MESMA do gráfico geral da aba Regência: o cálculo chama as próprias funções do gráfico
(Regência Real = diário ÷ ponto; sem ponto em pelo menos 2 meses do período, a regência planejada). Assim os
percentuais do painel e do gráfico são sempre iguais. Não usa dados da Não Regência.

Valores em reais, a partir dessa regência (r) e da capacidade:
- Capacidade = carga semanal contratada ÷ 5 × dias úteis do mês (segunda a sexta, menos as datas não letivas
  do Calendário Acadêmico), somada dos professores que entram na regência do mês.
- Produção = r × capacidade.
- Oportunidade total = (1 − r) × capacidade × valor da hora; até a meta = max(0, 70% − r) × capacidade × valor.
- Impacto do mês = (r do mês − r do mês anterior) × capacidade do mês × valor da hora.
Por professor, a mesma conta com a regência de cada um (a soma por professor pode diferir do total da equipe,
que segue a média simples do gráfico). Valor da hora = média informada; a estrutura aceita valor por professor.
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
from app.models.calendario import CalendarioAcademico
from app.models.professor import Professor
from app.services.regencia import META_REGENCIA_MENSALISTA, _horas_aula, _semanas_uteis

QUADRO = ["Mensalista", "Horista"]
META_EQUIPE = META_REGENCIA_MENSALISTA  # a linha de meta do gráfico geral (70%)


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


async def dias_uteis(db: AsyncSession, meses) -> dict[str, int]:
    """Dias úteis de cada mês: segunda a sexta, menos as datas não letivas do Calendário Acadêmico."""
    if not meses:
        return {}
    nao_letivos = set((await db.execute(select(CalendarioAcademico.data).where(
        CalendarioAcademico.letivo == False,  # noqa: E712
        CalendarioAcademico.data >= meses[0][1], CalendarioAcademico.data <= meses[-1][2],
    ))).scalars().all())
    saida = {}
    for k, m_ini, m_fim in meses:
        n, d = 0, m_ini
        while d <= m_fim:
            if d.weekday() < 5 and d not in nao_letivos:
                n += 1
            d += timedelta(days=1)
        saida[k] = n
    return saida


async def _professores(db: AsyncSession, area: Optional[str], modalidade: Optional[str]) -> dict[int, Professor]:
    profs = {p.id: p for p in (await db.execute(
        select(Professor).where(Professor.ativo == True, Professor.tipo.in_(QUADRO))  # noqa: E712
    )).scalars().all()}
    if area:
        profs = {i: p for i, p in profs.items() if p.area == area}
    if modalidade:
        mods = [x.strip() for x in modalidade.split(",") if x.strip()]
        ids = set((await db.execute(select(Atuacao.professor_id).where(Atuacao.modalidade.in_(mods)))).scalars().all())
        profs = {i: p for i, p in profs.items() if i in ids}
    return profs


async def _taxas_real(db, profs, meses) -> dict[tuple[int, str], float]:
    """Regência real de cada professor por mês — mesma regra do gráfico (diário ÷ ponto, limitada a 100%)."""
    from app.api.v1.diario import horas_executadas
    from app.models.diario import DiarioAula
    from app.services import ponto_gestao

    if not meses:
        return {}
    ini, ate = meses[0][1], meses[-1][2]
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
    return {k: min(1.0, diario.get(k, 0.0) / p) for k, p in ponto.items() if p > 0}


async def _taxas_planejada(db, profs, meses) -> dict[tuple[int, str], float]:
    """Regência planejada por professor e mês — mesma regra do gráfico (aulas ÷ carga × semanas, até 100%)."""
    if not meses:
        return {}
    aulas = (await db.execute(select(Aula).where(
        Aula.status.in_(["Realizada", "Agendada"]), Aula.data >= meses[0][1], Aula.data <= meses[-1][2],
        Aula.professor_id.in_(list(profs) or [0]),
    ))).scalars().all()
    vistos: dict[tuple, set] = defaultdict(set)
    horas: dict[tuple, float] = defaultdict(float)
    for a in aulas:
        k = f"{a.data.year}-{a.data.month:02d}"
        slot = (a.data, a.horario_inicio, a.horario_fim)
        if slot not in vistos[(a.professor_id, k)]:
            vistos[(a.professor_id, k)].add(slot)
            horas[(a.professor_id, k)] += _horas_aula(a)
    saida = {}
    for k, m_ini, m_fim in meses:
        semanas = _semanas_uteis(m_ini, m_fim)
        for pid, p in profs.items():
            cap = (p.horas_contratadas or 0) * semanas
            if cap > 0:
                saida[(pid, k)] = min(1.0, horas.get((pid, k), 0.0) / cap)
    return saida


async def calcular(db: AsyncSession, ini: date, fim: date, valor_hora: float, hoje: date,
                   fonte: str = "auto", mes: Optional[str] = None,
                   area: Optional[str] = None, modalidade: Optional[str] = None) -> dict:
    """Cada mês comparado com o anterior. `mes` = mês analisado nos cartões (padrão: o último)."""
    from app.api.v1.professores import regencia_mensal_geral, regencia_mensal_real

    ini_ref = (ini.replace(day=1) - timedelta(days=1)).replace(day=1)
    ref = f"{ini_ref.year}-{ini_ref.month:02d}"

    # Regência da equipe: as próprias funções do gráfico geral (mesmos números)
    serie_real = await regencia_mensal_real(data_inicio=ini_ref, data_fim=fim, modalidade=modalidade or None,
                                            area=area or None, db=db, _=None)
    if fonte == "auto":
        fonte = "real" if sum(1 for x in serie_real if x["mes"] != ref) >= 2 else "planejada"
    if fonte == "real":
        serie = serie_real
    else:
        fonte = "planejada"
        serie = await regencia_mensal_geral(data_inicio=ini_ref, data_fim=fim, modalidade=modalidade or None,
                                            area=area or None, apenas_realizadas=False, db=db, _=None)
    reg_equipe = {x["mes"]: x["media_percentual"] / 100 for x in serie if x["n_professores"]}

    profs = await _professores(db, area, modalidade)
    meses = meses_do_periodo(ini_ref, fim, hoje)
    taxas = await (_taxas_real if fonte == "real" else _taxas_planejada)(db, profs, meses)
    dias = await dias_uteis(db, meses)

    todas = [k for k, _, _ in meses if k in reg_equipe]
    chaves = [k for k in todas if k != ref]
    mes = mes if mes in chaves else (chaves[-1] if chaves else None)

    def valor(_pid: int) -> float:  # ponto único para o valor por professor no futuro
        return valor_hora

    def cap_prof(pid: int, k: str) -> float:
        return (profs[pid].horas_contratadas or 0) / 5 * dias.get(k, 0)

    linhas_mes = []
    por_prof: dict[tuple[int, str], dict] = {}
    for k in chaves:
        anterior = todas[todas.index(k) - 1] if todas.index(k) > 0 else None
        r = reg_equipe[k]
        r_ant = reg_equipe.get(anterior) if anterior else None
        ids = [pid for pid in profs if (pid, k) in taxas]
        cap = sum(cap_prof(pid, k) for pid in ids)
        ganho_h = (r - r_ant) * cap if r_ant is not None else None
        ocio = (1 - r) * cap
        falt = max(0.0, META_EQUIPE - r) * cap
        for pid in ids:
            p = profs[pid]
            t, c = taxas[(pid, k)], cap_prof(pid, k)
            t_ant = taxas.get((pid, anterior)) if anterior else None
            g = (t - t_ant) * c if t_ant is not None else None
            f = max(0.0, _meta(p.tipo) - t) * c
            por_prof[(pid, k)] = {
                "professor_id": pid, "nome": p.nome, "tipo": p.tipo, "area": p.area,
                "regencia_anterior": round(t_ant * 100, 1) if t_ant is not None else None,
                "regencia": round(t * 100, 1), "meta": round(_meta(p.tipo) * 100),
                "capacidade": round(c, 1), "producao": round(t * c, 1),
                "ganho_horas": round(g, 1) if g is not None else None,
                "ganho_reais": round(g * valor(pid), 2) if g is not None else None,
                "ociosas_horas": round((1 - t) * c, 1), "oportunidade_total_reais": round((1 - t) * c * valor(pid), 2),
                "faltante_horas": round(f, 1), "oportunidade_reais": round(f * valor(pid), 2),
            }
        linhas_mes.append({
            "mes": k, "mes_anterior": anterior, "n_professores": len(ids), "dias_uteis": dias.get(k, 0),
            "capacidade": round(cap, 1), "horas_sala": round(r * cap, 1),
            "regencia_pct": round(r * 100, 1),
            "regencia_anterior_pct": round(r_ant * 100, 1) if r_ant is not None else None,
            "ociosas_horas": round(ocio, 1), "oportunidade_total_reais": round(ocio * valor_hora, 2),
            "faltante_horas": round(falt, 1), "oportunidade_reais": round(falt * valor_hora, 2),
            "ganho_horas": round(ganho_h, 1) if ganho_h is not None else None,
            "ganho_reais": round(ganho_h * valor_hora, 2) if ganho_h is not None else None,
        })

    m = next((x for x in linhas_mes if x["mes"] == mes), None)
    professores = sorted((v for (pid, k), v in por_prof.items() if k == mes),
                         key=lambda x: -(x["ganho_reais"] if x["ganho_reais"] is not None else -1e12))
    com_ganho = [x for x in linhas_mes if x["ganho_reais"] is not None]
    return {
        "fonte": fonte, "valor_hora": valor_hora, "mes": mes, "meses": linhas_mes, "meses_disponiveis": chaves,
        "meta_equipe": round(META_EQUIPE * 100), "professores": professores,
        "resumo": {
            "mes": mes, "mes_anterior": m["mes_anterior"] if m else None,
            "regencia_anterior": m["regencia_anterior_pct"] if m else None,
            "regencia": m["regencia_pct"] if m else None,
            "variacao_pp": round(m["regencia_pct"] - m["regencia_anterior_pct"], 1)
                           if m and m["regencia_anterior_pct"] is not None else None,
            "ganho_horas": m["ganho_horas"] if m else None,
            "ganho_reais": m["ganho_reais"] if m else None,
            "capacidade": m["capacidade"] if m else 0.0,
            "dias_uteis": m["dias_uteis"] if m else 0,
            "producao": m["horas_sala"] if m else 0.0,
            "ociosas_horas": m["ociosas_horas"] if m else 0.0,
            "oportunidade_total_reais": m["oportunidade_total_reais"] if m else 0.0,
            "oportunidade_horas": m["faltante_horas"] if m else 0.0,
            "oportunidade_reais": m["oportunidade_reais"] if m else 0.0,
            "ganho_periodo_reais": round(sum(x["ganho_reais"] for x in com_ganho), 2),
            "ganho_periodo_horas": round(sum(x["ganho_horas"] for x in com_ganho), 1),
            "n_professores": m["n_professores"] if m else 0,
        },
    }
