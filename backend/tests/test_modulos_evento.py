"""Seletor de etapa do planejamento: usa a mesma resolução de curso da lista de UCs."""
from datetime import date, time

from app.models.curso import Curso
from app.models.evento import Evento
from app.models.oferta import OfertaCurso
from app.models.unidade_curricular import UnidadeCurricular
from tests.test_crm import _hdr, _usuario


async def test_etapas_de_evento_sem_curso_vinculado(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin")
    curso = Curso(nome="TECNOLOGIA EM DESIGN DE MODA", codigo="21858", carga_horaria_total=1700)
    db_session.add(curso)
    await db_session.flush()
    for i, etapa in enumerate(["1º PERÍODO", "2º PERÍODO", "10º PERÍODO", "1º PERÍODO"]):
        db_session.add(UnidadeCurricular(curso_id=curso.id, codigo_uc=str(900 + i), nome=f"UC {i}", modulo_etapa=etapa,
                                         carga_horaria=80))
    # Evento sem curso_id: o curso só é encontrado pela oferta com o mesmo código do evento
    ev = Evento(nome_turma="1071834", disciplina="DESIGN", carga_horaria_total=1700, horas_semanais=20,
                data_inicio=date(2026, 8, 24), data_fim=date(2028, 7, 1), dias_semana=[0], status="Ativo",
                horario_inicio=time(18, 45), horario_fim=time(22, 45))
    db_session.add(ev)
    await db_session.flush()
    db_session.add(OfertaCurso(codigo_evento=str(ev.id), modalidade="Superior", nome_curso=curso.nome, curso_id=curso.id))
    await db_session.flush()

    H = _hdr(admin)
    ucs = (await client.get(f"/api/v1/planejamento/ucs/{ev.id}", headers=H)).json()
    assert len(ucs) == 4
    modulos = (await client.get(f"/api/v1/planejamento/modulos/{ev.id}", headers=H)).json()
    assert modulos == ["1º PERÍODO", "2º PERÍODO", "10º PERÍODO"]
    so_2 = (await client.get(f"/api/v1/planejamento/ucs/{ev.id}", headers=H, params={"modulo": "2º PERÍODO"})).json()
    assert [u["nome"] for u in so_2] == ["UC 1"]


async def test_superior_planeja_a_partir_do_inicio_do_modulo(client, db_session):
    """2º semestre: as aulas começam na data do módulo, não no início do curso, e o limite é o semestre dele."""
    admin = await _usuario(db_session, "admin", "Admin")
    curso = Curso(nome="DESIGN SUPERIOR", codigo="21859", carga_horaria_total=1700)
    db_session.add(curso)
    await db_session.flush()
    uc = UnidadeCurricular(curso_id=curso.id, codigo_uc="30566", nome="DESENHO DE MODA", modulo_etapa="2º PERÍODO",
                           carga_horaria=80)
    ev = Evento(nome_turma="1071834", disciplina="DESIGN", carga_horaria_total=1700, horas_semanais=20,
                data_inicio=date(2026, 8, 24), data_fim=date(2028, 7, 1), dias_semana=[0, 1, 2, 3, 4], status="Ativo",
                horario_inicio=time(18, 45), horario_fim=time(22, 45), curso_id=curso.id)
    db_session.add_all([uc, ev])
    await db_session.flush()

    for rota in ("gerar", "gerar-otimizado"):
        r = await client.post(f"/api/v1/planejamento/{rota}/{ev.id}", headers=_hdr(admin), json={
            "ucs": [{"uc_id": uc.id, "ordem": 1, "data_inicio": "2027-01-25", "dias_semana": [0]}],
            "modo_superior": True, "clipar_semestre": True,
        })
        if r.status_code == 503 and rota == "gerar-otimizado":
            continue  # OR-Tools não instalado neste ambiente
        assert r.status_code == 200, (rota, r.text)
        datas = [d for a in r.json()["alocacoes"] for d in a["datas_aulas"]]
        assert datas, rota
        assert min(datas) >= "2027-01-25" and max(datas) <= "2027-06-30", (rota, min(datas), max(datas))
