"""Planejamento em lote: professores escolhidos em conjunto para todos os eventos do curso."""
import uuid
from collections import defaultdict
from datetime import date, time

from app.models.atuacao import Atuacao
from app.models.curso import Curso
from app.models.evento import Evento
from app.models.professor import Professor
from app.models.unidade_curricular import UnidadeCurricular
from tests.test_crm import _hdr, _usuario


async def _cenario(db):
    curso = Curso(nome="CURSO LOTE", codigo=f"LOTE{uuid.uuid4().hex[:8]}", carga_horaria_total=400)
    db.add(curso)
    await db.flush()
    u1 = UnidadeCurricular(curso_id=curso.id, codigo_uc="L1", nome="MODELAGEM LOTE", modulo_etapa="1º PERÍODO",
                           sequencia=1, carga_horaria=16)
    u2 = UnidadeCurricular(curso_id=curso.id, codigo_uc="L2", nome="DESENHO LOTE", modulo_etapa="1º PERÍODO",
                           sequencia=2, carga_horaria=16)
    u3 = UnidadeCurricular(curso_id=curso.id, codigo_uc="L3", nome="SEM DOCENTE LOTE", modulo_etapa="1º PERÍODO",
                           sequencia=3, carga_horaria=8)
    u9 = UnidadeCurricular(curso_id=curso.id, codigo_uc="L9", nome="OUTRA ETAPA LOTE", modulo_etapa="2º PERÍODO",
                           sequencia=1, carga_horaria=8)
    x = Professor(nome="PROF X LOTE", tipo="Mensalista", horas_contratadas=40, ativo=True)
    y = Professor(nome="PROF Y LOTE", tipo="Horista", horas_contratadas=40, ativo=True)
    db.add_all([u1, u2, u3, u9, x, y])
    await db.flush()
    db.add_all([
        Atuacao(professor_id=x.id, curso_id=curso.id, disciplina="MODELAGEM LOTE"),
        Atuacao(professor_id=x.id, curso_id=curso.id, disciplina="DESENHO LOTE"),
        Atuacao(professor_id=y.id, curso_id=curso.id, disciplina="MODELAGEM LOTE"),
    ])
    # Duas turmas no mesmo horário: as UCs acontecem em paralelo e disputam os mesmos professores
    evs = []
    for nome in ("TURMA A LOTE", "TURMA B LOTE"):
        ev = Evento(nome_turma=nome, disciplina="CURSO LOTE", carga_horaria_total=400, horas_semanais=20,
                    data_inicio=date(2027, 2, 1), data_fim=date(2027, 6, 30), dias_semana=[0, 1, 2, 3, 4],
                    status="Ativo", horario_inicio=time(19, 0), horario_fim=time(23, 0), curso_id=curso.id)
        db.add(ev)
        evs.append(ev)
    await db.flush()
    return curso, (u1, u2, u3), (x, y), evs


def _por_data_prof(resp):
    uso = defaultdict(list)
    for ev in resp["eventos"]:
        for a in ev["alocacoes"]:
            if a["professor_id"]:
                for d in a["datas_aulas"]:
                    uso[(a["professor_id"], d)].append(ev["evento_id"])
    return uso


async def test_lote_lista_eventos_e_etapas(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin")
    curso, *_ , evs = await _cenario(db_session)
    r = await client.get(f"/api/v1/planejamento-lote/eventos/{curso.id}", headers=_hdr(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["etapas"] == ["1º PERÍODO", "2º PERÍODO"]
    assert {e["id"] for e in body["eventos"]} == {e.id for e in evs}
    assert all(e["etapa_sugerida"] == "1º PERÍODO" for e in body["eventos"])


async def test_lote_escolhe_professores_em_conjunto(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin")
    curso, (u1, u2, u3), (x, y), evs = await _cenario(db_session)
    r = await client.post("/api/v1/planejamento-lote/preview", headers=_hdr(admin), json={
        "curso_id": curso.id,
        "eventos": [{"evento_id": e.id, "modulo": "1º PERÍODO"} for e in evs],
    })
    assert r.status_code == 200, r.text
    resp = r.json()

    # Só a etapa escolhida entra no lote
    nomes = {a["uc_nome"] for ev in resp["eventos"] for a in ev["alocacoes"]}
    assert nomes == {"MODELAGEM LOTE", "DESENHO LOTE", "SEM DOCENTE LOTE"}

    # Nenhum professor em duas turmas na mesma data
    assert all(len(v) == 1 for v in _por_data_prof(resp).values())

    # MODELAGEM em paralelo nas duas turmas: X numa, Y na outra; DESENHO só X pode → uma fica sem
    aloc = {(ev["evento_id"], a["uc_id"]): a for ev in resp["eventos"] for a in ev["alocacoes"]}
    assert {aloc[(e.id, u1.id)]["professor_id"] for e in evs} == {x.id, y.id}
    desenho = [aloc[(e.id, u2.id)]["professor_id"] for e in evs]
    assert sorted(desenho, key=lambda v: v or 0) == [None, x.id]

    motivos = {(s["uc_nome"], s["motivo"]) for s in resp["sem_professor"]}
    assert any(n == "SEM DOCENTE LOTE" and "Nenhum professor habilitado" in m for n, m in motivos)
    assert any(n == "DESENHO LOTE" and "disputam" in m for n, m in motivos)
    assert resp["resumo"]["cobertas"] == 3


async def test_lote_respeita_trava_e_confirma_com_rota_existente(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin")
    curso, (u1, u2, u3), (x, y), evs = await _cenario(db_session)
    a, b = evs
    r = await client.post("/api/v1/planejamento-lote/preview", headers=_hdr(admin), json={
        "curso_id": curso.id,
        "eventos": [{"evento_id": e.id, "modulo": "1º PERÍODO"} for e in evs],
        "travas": [{"evento_id": b.id, "uc_id": u1.id, "professor_id": x.id}],
    })
    assert r.status_code == 200, r.text
    resp = r.json()
    aloc = {(ev["evento_id"], al["uc_id"]): al for ev in resp["eventos"] for al in ev["alocacoes"]}
    assert aloc[(b.id, u1.id)]["professor_id"] == x.id and aloc[(b.id, u1.id)]["travado"]
    assert aloc[(a.id, u1.id)]["professor_id"] == y.id

    # Gravação: mesma rota do planejamento por evento
    for ev in resp["eventos"]:
        rc = await client.post(f"/api/v1/planejamento/confirmar/{ev['evento_id']}", headers=_hdr(admin),
                               json={"alocacoes": ev["alocacoes"], "substituir_futuras": True})
        assert rc.status_code == 200, rc.text


async def test_lote_seleciona_eventos_sem_escolher_curso(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin")
    curso, (u1, u2, u3), (x, y), evs = await _cenario(db_session)
    r = await client.get("/api/v1/planejamento-lote/eventos", headers=_hdr(admin))
    assert r.status_code == 200, r.text
    meus = [e for e in r.json()["eventos"] if e["id"] in {ev.id for ev in evs}]
    assert len(meus) == 2
    assert all(e["curso_id"] == curso.id and e["curso_nome"] == "CURSO LOTE" for e in meus)
    assert all(e["etapas"] == ["1º PERÍODO", "2º PERÍODO"] for e in meus)

    r = await client.post("/api/v1/planejamento-lote/preview", headers=_hdr(admin), json={
        "eventos": [{"evento_id": e.id, "modulo": "1º PERÍODO"} for e in evs],
    })
    assert r.status_code == 200, r.text
    assert r.json()["resumo"]["cobertas"] == 3
