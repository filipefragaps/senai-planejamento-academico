"""Seletor de etapa do planejamento: usa a mesma resolução de curso da lista de UCs."""
from datetime import date, time, timedelta

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


async def _planejar_superior_com_sabado(client, db_session, codigo: str, ch_pi: int, rota: str = "gerar"):
    admin = await _usuario(db_session, "admin", "Admin")
    curso = Curso(nome=f"DESIGN SUP {codigo}", codigo=codigo, carga_horaria_total=1700)
    db_session.add(curso)
    await db_session.flush()
    nomes = [("SEG", 80, 0), ("TER", 80, 1), ("QUA CURTA", 16, 2), ("QUI", 80, 3), ("SEX", 80, 4), ("PI II", ch_pi, 5)]
    ucs = []
    for nome, ch, _ in nomes:
        u = UnidadeCurricular(curso_id=curso.id, codigo_uc=f"{codigo}{len(ucs)}", nome=nome,
                              modulo_etapa="2º PERÍODO", carga_horaria=ch)
        db_session.add(u)
        ucs.append(u)
    ev = Evento(nome_turma=f"T{codigo}", disciplina="DESIGN", carga_horaria_total=1700, horas_semanais=20,
                data_inicio=date(2026, 8, 24), data_fim=date(2028, 7, 1), dias_semana=[0, 1, 2, 3, 4, 5], status="Ativo",
                horario_inicio=time(18, 45), horario_fim=time(22, 45), curso_id=curso.id)
    db_session.add(ev)
    await db_session.flush()
    r = await client.post(f"/api/v1/planejamento/{rota}/{ev.id}", headers=_hdr(admin), json={
        "ucs": [{"uc_id": u.id, "ordem": i + 1, "data_inicio": "2027-01-25", "dias_semana": [dia]}
                for i, (u, (_, _, dia)) in enumerate(zip(ucs, nomes))],
        "modo_superior": True, "clipar_semestre": True,
    })
    if r.status_code == 503 and rota == "gerar-otimizado":
        return None  # OR-Tools não instalado neste ambiente
    assert r.status_code == 200, r.text
    alocs = r.json()["alocacoes"]
    assert [a["uc_nome"] for a in alocs] == [n for n, _, _ in nomes]  # ordem do currículo mantida
    todas = [d for a in alocs for d in a["datas_aulas"]]
    assert len(todas) == len(set(todas))  # nenhuma data com duas UCs
    return alocs


async def test_superior_sabado_nao_usado_quando_dias_uteis_bastam(client, db_session):
    """A UC fixada no sábado vai para a quarta que fica livre e não usa sábado, pois a CH cabe no semestre."""
    alocs = await _planejar_superior_com_sabado(client, db_session, "S1", 40)
    pi = [date.fromisoformat(d) for d in alocs[-1]["datas_aulas"]]
    fim_qua = max(date.fromisoformat(d) for d in alocs[2]["datas_aulas"])
    assert len(pi) == 10
    assert all(d.weekday() == 2 and d > fim_qua for d in pi), " ".join(map(str, pi))


async def test_superior_sabado_so_o_que_faltar(client, db_session):
    """CH maior que os dias úteis livres: usa todos eles e completa com os primeiros sábados."""
    alocs = await _planejar_superior_com_sabado(client, db_session, "S2", 160)
    pi = [date.fromisoformat(d) for d in alocs[-1]["datas_aulas"]]
    assert len(pi) == 40
    assert any(d.weekday() == 5 for d in pi)
    ocupadas = {date.fromisoformat(d) for a in alocs for d in a["datas_aulas"]}
    d, livres = date(2027, 1, 25), []
    while d <= date(2027, 6, 30):
        if d.weekday() < 5 and d not in ocupadas:
            livres.append(d)
        d += timedelta(days=1)
    assert not livres, livres  # nenhum dia útil ficou vazio enquanto se usou sábado


async def test_otimizado_superior_sabado_so_sem_dia_util(client, db_session):
    """Otimizado: mesma regra do sábado e início no módulo."""
    alocs = await _planejar_superior_com_sabado(client, db_session, "S3", 40, rota="gerar-otimizado")
    if alocs is None:
        return
    todas = [date.fromisoformat(d) for a in alocs for d in a["datas_aulas"]]
    assert min(todas) >= date(2027, 1, 25)
    assert not [d for d in todas if d.weekday() == 5], "sábado usado com dia útil livre"
