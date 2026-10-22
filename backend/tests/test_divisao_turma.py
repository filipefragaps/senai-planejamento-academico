"""Divisão de turma: segundo professor com segundo ambiente."""
import os
from datetime import date, time

from app.models.aula import Aula
from app.models.evento import Evento
from app.models.grupo_aula import GrupoAula


async def _evento(db):
    ev = Evento(nome_turma="1089644 – SOLDAGEM", disciplina="SOLDAGEM MIG MAG", carga_horaria_total=40,
                horas_semanais=4, data_inicio=date(2026, 1, 1), data_fim=date(2026, 12, 31), dias_semana=[0],
                horario_inicio=time(8), horario_fim=time(12))
    db.add(ev)
    await db.flush()
    return ev


async def test_segundo_ambiente_salva_sincroniza_grupo_e_aparece(auth_client, db_session, professor_mensalista,
                                                                  professor_horista, monkeypatch):
    ev = await _evento(db_session)
    grupo = GrupoAula()
    db_session.add(grupo)
    await db_session.flush()
    dia = date(2026, 10, 26)
    a1 = Aula(evento_id=ev.id, data=dia, horario_inicio=time(8), horario_fim=time(10), grupo_aula_id=grupo.id,
              professor_id=professor_mensalista.id, ambiente="LAB-SOLDA 1")
    a2 = Aula(evento_id=ev.id, data=dia, horario_inicio=time(10), horario_fim=time(12), grupo_aula_id=grupo.id,
              professor_id=professor_mensalista.id, ambiente="LAB-SOLDA 1")
    db_session.add_all([a1, a2])
    await db_session.flush()

    r = await auth_client.put(f"/api/v1/aulas/{a1.id}", json={
        "alteracoes": {"professor2_id": professor_horista.id, "ambiente2": "LAB-SOLDA 2"},
        "replaneja_futuras": False,
    })
    assert r.status_code == 200, r.text
    assert r.json()["aula_alterada"]["ambiente2"] == "LAB-SOLDA 2"

    # Aula irmã do mesmo grupo recebe o mesmo 2º professor e 2º ambiente
    await db_session.refresh(a2)
    assert a2.professor2_id == professor_horista.id and a2.ambiente2 == "LAB-SOLDA 2"

    crono = (await auth_client.get("/api/v1/planejamento/cronograma", params={"evento_id": ev.id})).json()
    itens = crono["aulas"] if isinstance(crono, dict) else crono
    assert {(x["ambiente"], x["ambiente2"]) for x in itens} == {("LAB-SOLDA 1", "LAB-SOLDA 2")}

    # Totem mostra os dois professores e os dois ambientes
    monkeypatch.setitem(os.environ, "TOTEM_TOKEN", "tok")
    totem = (await auth_client.get("/api/v1/planejamento/totem", params={"token": "tok", "data": dia.isoformat()})).json()
    assert totem[0]["ambiente"] == "LAB-SOLDA 1 / LAB-SOLDA 2"
    assert totem[0]["professor"] == f"{professor_mensalista.nome} / {professor_horista.nome}"

    # Remover a divisão limpa o 2º ambiente
    r = await auth_client.put(f"/api/v1/aulas/{a1.id}", json={
        "alteracoes": {"professor2_id": None, "ambiente2": None}, "replaneja_futuras": False,
    })
    assert r.status_code == 200 and r.json()["aula_alterada"]["ambiente2"] is None
