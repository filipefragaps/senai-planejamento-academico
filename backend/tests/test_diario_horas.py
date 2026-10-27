"""Horas executadas do diário: duas turmas no mesmo horário contam uma vez; vínculo pelo evento certo."""
from datetime import date, time

from app.api.v1.diario import horas_executadas
from app.models.aula import Aula
from app.models.diario import DiarioAula
from app.models.evento import Evento


def _reg(dia, ini, fim, qtde=None, codigo=None):
    return DiarioAula(instrutor="X", data=dia, hora_inicio=ini, hora_termino=fim, qtde_horas=qtde, evento_codigo=codigo)


def test_horas_executadas_turmas_simultaneas():
    d1, d2 = date(2026, 8, 5), date(2026, 8, 6)
    assert horas_executadas([
        _reg(d1, time(13, 30), time(17, 30), 4, "1057087"),
        _reg(d1, time(13, 30), time(17, 30), 4, "1049673"),   # mesma tarde, outra turma
    ]) == 4
    # Horários um pouco diferentes também são a mesma tarde (antes contava 8h)
    assert horas_executadas([
        _reg(d1, time(13, 30), time(17, 30), 4), _reg(d1, time(13, 40), time(17, 30), 4),
    ]) == 4
    # Sobreposição parcial: vale a união (13:30–19:30 = 6h)
    assert horas_executadas([_reg(d1, time(13, 30), time(17, 30), 4), _reg(d1, time(15, 30), time(19, 30), 4)]) == 6
    # Aulas em sequência e em dias diferentes somam normalmente; aula isolada usa a QTDE do diário
    assert horas_executadas([
        _reg(d1, time(8), time(12), 4), _reg(d1, time(13, 30), time(17, 30), 4), _reg(d2, time(7, 30), time(12), 4),
    ]) == 12
    # Sem horário: uma vez por dia
    assert horas_executadas([_reg(d1, None, None, 4), _reg(d1, None, None, 4)]) == 4


async def test_comparacao_vincula_pelo_evento_e_stats_iguala_modal(auth_client, db_session, professor_horista):
    evs = []
    for codigo in ("1057087", "1049673"):
        ev = Evento(nome_turma=codigo, disciplina="ASSISTENTE ADMINISTRATIVO", carga_horaria_total=40,
                    horas_semanais=4, data_inicio=date(2026, 8, 1), data_fim=date(2026, 9, 30), dias_semana=[2],
                    horario_inicio=time(13, 30), horario_fim=time(17, 30))
        db_session.add(ev)
        evs.append(ev)
    await db_session.flush()
    dia = date(2026, 8, 5)
    # Planejadas na ordem inversa à do diário: antes, as duas pegavam o registro do 1057087
    for ev in reversed(evs):
        db_session.add(Aula(evento_id=ev.id, professor_id=professor_horista.id, data=dia,
                            horario_inicio=time(13, 30), horario_fim=time(17, 30), uc_nome_original="FERRAMENTAS DA QUALIDADE"))
    for codigo in ("1057087", "1049673"):
        r = _reg(dia, time(13, 30), time(17, 30), 4, codigo)
        r.instrutor, r.professor_id = professor_horista.nome, professor_horista.id
        db_session.add(r)
    await db_session.flush()

    params = {"data_inicio": "2026-08-01", "data_fim": "2026-09-30"}
    comp = (await auth_client.get(f"/api/v1/diario/comparacao/{professor_horista.id}", params=params)).json()
    assert all(p["diario"]["evento_codigo"] == p["evento_codigo"] for p in comp["planejadas"])
    assert comp["somente_diario"] == []
    assert comp["horas_executadas"] == 4

    stats = (await auth_client.get("/api/v1/diario/stats", params=params)).json()
    assert stats[str(professor_horista.id)] == 4
