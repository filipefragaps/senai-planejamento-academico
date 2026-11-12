"""Impacto financeiro da regência: mesma regência do gráfico geral, valores em reais sobre a carga contratada."""
from datetime import date, time, timedelta

import pytest

from app.models.aula import Aula
from app.models.calendario import CalendarioAcademico
from app.models.evento import Evento
from app.models.professor import Professor
from tests.test_crm import _hdr, _usuario

AREA = "Área teste financeiro"


def _dias_uteis(ano, mes):
    d = date(ano, mes, 1)
    while d.month == mes:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


async def test_regencia_igual_ao_grafico_e_valores(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin")
    ana = Professor(nome="Ana", tipo="Mensalista", horas_contratadas=20, ativo=True, area=AREA)
    bia = Professor(nome="Bia", tipo="Horista", horas_contratadas=10, ativo=True, area=AREA)
    externo = Professor(nome="Externo", tipo="RPA", horas_contratadas=10, ativo=True, area=AREA)
    ev = Evento(nome_turma="T", disciplina="X", carga_horaria_total=10, horas_semanais=4, data_inicio=date(2026, 2, 1),
                data_fim=date(2026, 4, 30), dias_semana=[0], status="Ativo", horario_inicio=time(8), horario_fim=time(12))
    # Feriado de abril: sai da capacidade em reais
    db_session.add_all([ana, bia, externo, ev, CalendarioAcademico(data=date(2026, 4, 21), tipo="Feriado", letivo=False)])
    await db_session.flush()

    def aulas(prof, ano, mes, n):
        for d in list(_dias_uteis(ano, mes))[:n]:
            db_session.add(Aula(evento_id=ev.id, professor_id=prof.id, data=d, horario_inicio=time(8), horario_fim=time(12),
                                status="Realizada"))

    aulas(ana, 2026, 2, 2)
    aulas(ana, 2026, 3, 3)
    aulas(ana, 2026, 4, 10)
    aulas(bia, 2026, 3, 13)
    aulas(bia, 2026, 4, 11)
    aulas(externo, 2026, 4, 10)  # fora do quadro
    await db_session.flush()

    H = _hdr(admin)
    params = {"data_inicio": "2026-03-01", "data_fim": "2026-04-30", "valor_hora": 50, "area": AREA}
    d = (await client.get("/api/v1/regencia-financeiro", headers=H, params=params)).json()
    grafico = (await client.get("/api/v1/professores/regencia-mensal", headers=H, params={
        "data_inicio": "2026-03-01", "data_fim": "2026-04-30", "area": AREA})).json()

    # A regência do painel é exatamente a do gráfico, mês a mês
    assert d["fonte"] == "planejada"
    assert [(m["mes"], m["regencia_pct"]) for m in d["meses"]] == [(g["mes"], g["media_percentual"]) for g in grafico]

    mar, abr = d["meses"]
    assert abr["dias_uteis"] == 21 and abr["capacidade"] == pytest.approx((20 + 10) / 5 * 21)
    r_mar, r_abr = mar["regencia_pct"] / 100, abr["regencia_pct"] / 100
    assert abr["ganho_reais"] == pytest.approx((r_abr - r_mar) * abr["capacidade"] * 50, abs=0.05)
    assert abr["oportunidade_total_reais"] == pytest.approx((1 - r_abr) * abr["capacidade"] * 50, abs=0.05)
    assert abr["oportunidade_reais"] == pytest.approx(max(0, 0.7 - r_abr) * abr["capacidade"] * 50, abs=0.05)
    # Março também é comparado com fevereiro (mês de referência fora do período)
    assert mar["mes_anterior"] == "2026-02" and mar["ganho_reais"] is not None
    res = d["resumo"]
    assert res["mes"] == "2026-04" and res["regencia"] == abr["regencia_pct"] and res["regencia_anterior"] == mar["regencia_pct"]
    assert {p["nome"] for p in d["professores"]} == {"Ana", "Bia"}

    d = (await client.get("/api/v1/regencia-financeiro", headers=H, params={**params, "mes": "2026-03"})).json()
    assert d["resumo"]["mes"] == "2026-03"
