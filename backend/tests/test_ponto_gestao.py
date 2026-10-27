"""Regência: horas de ponto vêm da Gestão de Ponto (sem planilha de ponto importada)."""
from datetime import date, time

from app.models.diario import DiarioAula


def _dia(matricula, nome, data, batidos, previstos=240, email="", punches=True):
    return {"matricula": matricula, "collaborator": nome, "email": email, "date": data,
            "workedMinutes": batidos, "expectedMinutes": previstos, "punches": ["13:30", "17:30"] if punches else []}


async def test_horas_do_ponto_vem_da_gestao_de_ponto(auth_client, db_session, professor_horista, professor_mensalista):
    professor_mensalista.email = "Mensal@Fieg.com.br"
    await db_session.flush()
    dias = [
        # Ligado pelo nome (com acento/caixa diferentes)
        _dia("100", "PROF TESTE HORÍSTA", "05/08/2026", 240),
        _dia("100", "PROF TESTE HORÍSTA", "06/08/2026", 250),
        _dia("100", "PROF TESTE HORÍSTA", "02/09/2026", 230),
        _dia("100", "PROF TESTE HORÍSTA", "02/07/2026", 600),           # fora do período
        # Nome diferente no FPW, ligado pelo e-mail
        _dia("200", "FULANO MENSALISTA", "10/08/2026", 480, 480, email="mensal@fieg.com.br"),
        # Não é professor / não bate ponto: ignorados
        _dia("300", "OUTRA PESSOA", "10/08/2026", 480),
        _dia("400", "PROF TESTE HORISTA SEM PONTO", "10/08/2026", 0, punches=False),
    ]
    snapshot = {"analysisVersion": 19, "data": {"contacts": [], "items": [], "result": {"days": dias}}}
    assert (await auth_client.post("/api/v1/gestao-ponto/painel", json=snapshot)).status_code == 200

    params = {"data_inicio": "2026-08-01", "data_fim": "2026-09-30"}
    stats = (await auth_client.get("/api/v1/ponto/stats", params=params)).json()
    assert stats == {str(professor_horista.id): round((240 + 250 + 230) / 60, 2), str(professor_mensalista.id): 8.0}

    r = (await auth_client.get(f"/api/v1/ponto/professor/{professor_horista.id}", params=params)).json()
    assert [(x["data_inicio"], x["horas_total"]) for x in r["registros"]] == [("2026-08-01", round(490 / 60, 2)),
                                                                             ("2026-09-01", round(230 / 60, 2))]
    assert r["registros"][0]["horas_extras"] == round((490 - 480) / 60, 2)
    assert r["totais"]["horas_total"] == 12.0

    info = (await auth_client.get("/api/v1/ponto/info")).json()
    assert info["fonte"] == "gestao_ponto" and info["colaboradores"] == 3 and info["importado_em"]
    assert info["data_inicio"] == "2026-07-02" and info["data_fim"] == "2026-09-02"

    # Regência real mensal: diário ÷ ponto da Gestão de Ponto (agosto: 4h ÷ 8h10)
    db_session.add(DiarioAula(instrutor=professor_horista.nome, professor_id=professor_horista.id,
                              data=date(2026, 8, 5), qtde_horas=4,
                              hora_inicio=time(13, 30), hora_termino=time(17, 30)))
    await db_session.flush()
    mensal = (await auth_client.get("/api/v1/professores/regencia-mensal-real",
                                    params={"data_inicio": "2026-08-01", "data_fim": "2026-08-31"})).json()
    assert mensal and mensal[0]["mes"] == "2026-08"

    # Painel atualizado (nova importação) → valores recalculados
    snapshot["data"]["result"]["days"] = [_dia("100", "PROF TESTE HORISTA", "05/08/2026", 120)]
    await auth_client.post("/api/v1/gestao-ponto/painel", json=snapshot)
    stats = (await auth_client.get("/api/v1/ponto/stats", params=params)).json()
    assert stats == {str(professor_horista.id): 2.0}
