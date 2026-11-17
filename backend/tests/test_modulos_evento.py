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
