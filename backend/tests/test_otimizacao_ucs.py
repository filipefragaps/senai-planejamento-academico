"""Otimização de regência só usa professores com a UC cadastrada; UCs sem professor listam candidatos."""
from datetime import date, time, timedelta

from sqlalchemy import select

from app.models.atuacao import Atuacao
from app.models.aula import Aula
from app.models.curso import Curso
from app.models.evento import Evento
from app.models.professor import Professor
from app.models.unidade_curricular import UnidadeCurricular
from app.services.otimizacao_global_service import analisar_otimizacao_global

HOJE = date(2026, 11, 2)  # segunda-feira


async def _cenario(db, professor_mensalista, professor_horista):
    curso = Curso(nome="TÉCNICO EM ELETRÔNICA", codigo="ELT", carga_horaria_total=1200)
    db.add(curso)
    await db.flush()
    uc = UnidadeCurricular(curso_id=curso.id, codigo_uc="1", nome="Eletrônica Digital - OPTATIVA")
    outra = UnidadeCurricular(curso_id=curso.id, codigo_uc="2", nome="Fundamentos Mecânicos")
    db.add_all([uc, outra])
    ev = Evento(nome_turma="1068416", disciplina="TÉCNICO EM ELETRÔNICA", carga_horaria_total=80, horas_semanais=4,
                data_inicio=HOJE, data_fim=HOJE + timedelta(days=60), dias_semana=[0],
                horario_inicio=time(19), horario_fim=time(22), status="Ativo")
    db.add(ev)
    # Mensalista: mesmo curso, mas só "Fundamentos Mecânicos" cadastrada → não pode Eletrônica Digital
    db.add(Atuacao(professor_id=professor_mensalista.id, curso_id=curso.id, disciplina="Fundamentos Mecânicos"))
    # Horista: Eletrônica Digital cadastrada em outro texto (acento/caixa)
    db.add(Atuacao(professor_id=professor_horista.id, curso_id=None, disciplina="ELETRONICA DIGITAL"))
    await db.flush()
    for i in range(3):
        db.add(Aula(evento_id=ev.id, unidade_curricular_id=uc.id, data=HOJE + timedelta(days=7 * i),
                    horario_inicio=time(19), horario_fim=time(22)))
    await db.flush()
    return ev, uc


async def test_otimizacao_so_usa_professor_com_a_uc_cadastrada(db_session, professor_mensalista, professor_horista):
    _, uc = await _cenario(db_session, professor_mensalista, professor_horista)
    res = await analisar_otimizacao_global(db_session, hoje=HOJE)
    assert [(r["uc_id"], r["prof_novo_id"]) for r in res["remanejamentos"]] == [(uc.id, professor_horista.id)]


async def test_ucs_sem_professor_lista_candidatos_e_atribui(auth_client, db_session, professor_mensalista,
                                                            professor_horista):
    ev, uc = await _cenario(db_session, professor_mensalista, professor_horista)
    # Outro horista com a UC, mas já dando aula no mesmo horário da 1ª aula → vem depois, com 1 choque
    ocupado = Professor(nome="Prof Ocupado", tipo="Horista", horas_contratadas=20, ativo=True)
    db_session.add(ocupado)
    await db_session.flush()
    db_session.add(Atuacao(professor_id=ocupado.id, disciplina="Eletrônica Digital"))
    outro_ev = Evento(nome_turma="999", disciplina="X", carga_horaria_total=10, horas_semanais=3,
                      data_inicio=HOJE, data_fim=HOJE, dias_semana=[0], status="Ativo",
                      horario_inicio=time(20), horario_fim=time(22))
    db_session.add(outro_ev)
    await db_session.flush()
    db_session.add(Aula(evento_id=outro_ev.id, professor_id=ocupado.id, data=HOJE + timedelta(days=7),
                        horario_inicio=time(20), horario_fim=time(22)))
    await db_session.flush()

    from app.services import otimizacao_global_service as svc
    res = await svc.ucs_sem_professor(db_session, hoje=HOJE)
    assert len(res["ucs"]) == 1
    item = res["ucs"][0]
    assert (item["evento_id"], item["uc_id"], item["num_aulas"], item["horas"]) == (ev.id, uc.id, 3, 9)
    assert [(c["nome"], c["choques"]) for c in item["candidatos"]] == [("Prof Teste Horista", 0), ("Prof Ocupado", 1)]

    total = await svc.atribuir_professor_uc(db_session, ev.id, uc.id, professor_horista.id, hoje=HOJE)
    assert total == 3
    profs = (await db_session.execute(select(Aula.professor_id).where(Aula.evento_id == ev.id))).scalars().all()
    assert set(profs) == {professor_horista.id}

    # Endpoint responde (sem UCs abertas no futuro real após a atribuição)
    r = await auth_client.get("/api/v1/planejamento/ucs-sem-professor")
    assert r.status_code == 200 and r.json()["ucs"] == []
