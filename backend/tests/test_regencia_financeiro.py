"""Impacto financeiro da regência: ganho pela taxa do mês-base e oportunidade até a meta."""
from datetime import date, time, timedelta

import pytest

from app.models.aula import Aula
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


async def test_ganho_e_oportunidade_planejada(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin")
    ana = Professor(nome="Ana", tipo="Mensalista", horas_contratadas=20, ativo=True, area=AREA)
    bia = Professor(nome="Bia", tipo="Horista", horas_contratadas=10, ativo=True, area=AREA)
    externo = Professor(nome="Externo", tipo="RPA", horas_contratadas=10, ativo=True, area=AREA)
    ev = Evento(nome_turma="T", disciplina="X", carga_horaria_total=10, horas_semanais=4, data_inicio=date(2026, 3, 1),
                data_fim=date(2026, 4, 30), dias_semana=[0], status="Ativo", horario_inicio=time(8), horario_fim=time(12))
    db_session.add_all([ana, bia, externo, ev])
    await db_session.flush()

    def aulas(prof, ano, mes, n):
        for d in list(_dias_uteis(ano, mes))[:n]:
            db_session.add(Aula(evento_id=ev.id, professor_id=prof.id, data=d, horario_inicio=time(8), horario_fim=time(12)))

    # Março e abril/2026 têm 22 dias úteis → 4,4 semanas
    aulas(ana, 2026, 3, 3)    # 12h de 88h
    aulas(ana, 2026, 4, 10)   # 40h de 88h
    aulas(bia, 2026, 3, 13)   # 52h, limitado a 44h (excedente do horista não é economia)
    aulas(bia, 2026, 4, 11)   # 44h
    aulas(externo, 2026, 4, 10)  # fora do quadro: ignorado
    await db_session.flush()

    r = await client.get("/api/v1/regencia-financeiro", headers=_hdr(admin), params={
        "data_inicio": "2026-03-01", "data_fim": "2026-04-30", "valor_hora": 50, "area": AREA})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["fonte"] == "planejada" and d["mes_base"] == "2026-03"
    mar, abr = d["meses"]
    assert mar["ganho_reais"] is None and mar["n_professores"] == 2
    # Ganho: Ana 40 − 12/88×88 = 28h; Bia 44 − 1×44 = 0
    assert abr["ganho_horas"] == 28 and abr["ganho_reais"] == 1400
    # Oportunidade: Ana 70%×88 − h; Bia já na meta de 100%
    assert mar["faltante_horas"] == pytest.approx(49.6) and mar["oportunidade_reais"] == pytest.approx(2480)
    assert abr["faltante_horas"] == pytest.approx(21.6) and abr["oportunidade_reais"] == pytest.approx(1080)
    res = d["resumo"]
    assert res["ganho_reais"] == 1400 and res["reducao_oportunidade_reais"] == pytest.approx(1400)
    assert res["regencia_base"] == round(56 / 132 * 100, 1) and res["regencia_ultimo"] == round(84 / 132 * 100, 1)
    assert [p["nome"] for p in d["professores"]] == ["Ana", "Bia"]

    # Mês-base escolhido: abril → sem ganho depois dele
    d = (await client.get("/api/v1/regencia-financeiro", headers=_hdr(admin), params={
        "data_inicio": "2026-03-01", "data_fim": "2026-04-30", "valor_hora": 50, "mes_base": "2026-04", "area": AREA})).json()
    assert d["mes_base"] == "2026-04" and d["resumo"]["ganho_reais"] == 0
