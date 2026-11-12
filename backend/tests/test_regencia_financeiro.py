"""Impacto financeiro da regência: ganho de cada mês sobre o anterior e oportunidade até a meta."""
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

    params = {"data_inicio": "2026-03-01", "data_fim": "2026-04-30", "valor_hora": 50, "area": AREA}
    r = await client.get("/api/v1/regencia-financeiro", headers=_hdr(admin), params=params)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["fonte"] == "planejada" and d["mes"] == "2026-04"
    mar, abr = d["meses"]  # fevereiro é só a referência do primeiro mês
    assert (mar["mes_anterior"], abr["mes_anterior"]) == ("2026-02", "2026-03")
    # Março × fevereiro (sem aulas): Ana 12h + Bia 44h (limitado à carga)
    assert mar["ganho_horas"] == 56 and mar["ganho_reais"] == 2800
    # Abril × março: Ana 40 − 12/88×88 = 28h; Bia segue em 100% → 0
    assert abr["ganho_horas"] == 28 and abr["ganho_reais"] == 1400
    # Oportunidade até a meta: Ana 70%×88 − h; Bia já na meta de 100%
    assert mar["oportunidade_reais"] == pytest.approx(2480) and abr["faltante_horas"] == pytest.approx(21.6)
    res = d["resumo"]
    assert (res["mes"], res["mes_anterior"], res["ganho_reais"]) == ("2026-04", "2026-03", 1400)
    assert res["regencia_anterior"] == round(56 / 132 * 100, 1) and res["regencia"] == round(84 / 132 * 100, 1)
    assert res["oportunidade_reais"] == pytest.approx(1080) and res["ganho_periodo_reais"] == 4200
    profs = {p["nome"]: p for p in d["professores"]}
    assert set(profs) == {"Ana", "Bia"} and profs["Ana"]["ganho_reais"] == 1400

    # Analisar março
    d = (await client.get("/api/v1/regencia-financeiro", headers=_hdr(admin), params={**params, "mes": "2026-03"})).json()
    assert d["resumo"]["ganho_reais"] == 2800 and d["resumo"]["regencia_anterior"] == 0
