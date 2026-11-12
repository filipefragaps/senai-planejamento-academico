"""Gestão da Não Regência: carga no período, alocações, apontamentos, entregas, permissões e relatórios."""
from datetime import date, time

import pytest

from app.models.aula import Aula
from app.models.calendario import CalendarioAcademico
from app.models.evento import Evento
from app.models.professor import Professor
from tests.test_crm import _hdr, _usuario

URL = "/api/v1/nao-regencia"
MARCO = {"ini": "2026-03-01", "fim": "2026-03-31"}


async def _cenario(client, db):
    """Professora Ana, 40h/sem (8h/dia), em março/2026:
    22 dias úteis − feriado 20/03 = 21 → 168h; afastada 23–27/03 (5 dias) → 128h disponíveis."""
    admin = await _usuario(db, "admin", "Admin")
    resp = await _usuario(db, "coordenador", "Responsável P1")
    prof_user = await _usuario(db, "professor", "Ana Professora")
    ana = Professor(nome="Ana", tipo="Mensalista", horas_contratadas=40, ativo=True, email=prof_user.email.upper())
    bia = Professor(nome="Bia", tipo="Mensalista", horas_contratadas=20, ativo=True)
    db.add_all([ana, bia, CalendarioAcademico(data=date(2026, 3, 20), tipo="Feriado", letivo=False)])
    await db.flush()
    ev1 = Evento(nome_turma="T1", disciplina="X", carga_horaria_total=10, horas_semanais=3, data_inicio=date(2026, 3, 1),
                 data_fim=date(2026, 3, 31), dias_semana=[1], status="Ativo", horario_inicio=time(19), horario_fim=time(22))
    ev2 = Evento(nome_turma="T2", disciplina="Y", carga_horaria_total=10, horas_semanais=3, data_inicio=date(2026, 3, 1),
                 data_fim=date(2026, 3, 31), dias_semana=[1], status="Ativo", horario_inicio=time(19), horario_fim=time(22))
    db.add_all([ev1, ev2])
    await db.flush()
    db.add_all([
        Aula(evento_id=ev1.id, professor_id=ana.id, data=date(2026, 3, 3), horario_inicio=time(19), horario_fim=time(22), status="Realizada"),
        # Turma junta no mesmo horário: conta uma vez (mesma regra da aba Regência)
        Aula(evento_id=ev2.id, professor_id=ana.id, data=date(2026, 3, 3), horario_inicio=time(19), horario_fim=time(22), status="Realizada"),
        Aula(evento_id=ev1.id, professor_id=ana.id, data=date(2026, 3, 4), horario_inicio=time(19), horario_fim=time(22), status="Agendada"),
    ])
    await db.flush()
    H = _hdr(admin)

    r = await client.post(f"{URL}/afastamentos", headers=H, json={
        "professor_id": ana.id, "tipo": "Férias", "data_inicio": "2026-03-23", "data_fim": "2026-03-27"})
    assert r.status_code == 200, r.text
    r = await client.post(f"{URL}/outras-alocacoes", headers=H, json={
        "professor_id": ana.id, "descricao": "Comissão de estágio", "data_inicio": "2026-03-01", "horas_semanais": 2})
    assert r.status_code == 200, r.text

    async def projeto(nome, ini, fim, **extra):
        r = await client.post(f"{URL}/projetos", headers=H, json={
            "nome": nome, "situacao": "em_andamento", "data_inicio": ini, "data_fim_prevista": fim, **extra})
        assert r.status_code == 200, r.text
        return r.json()

    p1 = await projeto("Laboratório de IoT", "2026-03-16", "2026-06-30", responsavel_id=resp.id)  # começa no meio do mês
    p2 = await projeto("Plano de curso", "2026-03-02", "2026-06-30")
    p3 = await projeto("Extensão", "2026-03-01", "2026-03-31")
    assert p1["codigo"] == f"NR-2026-{p1['id']:04d}" and p1["nome"] == "LABORATÓRIO DE IOT"

    # Vários professores numa só chamada; carga muda de 10h para 20h/sem a partir de 30/03
    r = await client.post(f"{URL}/projetos/{p1['id']}/vinculos", headers=H, json={"vinculos": [
        {"professor_id": ana.id, "horas_semanais": 10, "papel": "Pesquisadora", "responsabilidades": "Montar bancada",
         "periodos": [{"data_inicio": "2026-03-30", "horas_semanais": 20}]},
        {"professor_id": bia.id, "horas_semanais": 4},
    ]})
    assert r.status_code == 200, r.text
    v1_ana, v1_bia = r.json()["criados"]
    v2 = (await client.post(f"{URL}/projetos/{p2['id']}/vinculos", headers=H, json={"vinculos": [
        {"professor_id": ana.id, "horas_semanais": 5, "responsabilidades": "Redigir plano"}]})).json()["criados"][0]
    v3 = (await client.post(f"{URL}/projetos/{p3['id']}/vinculos", headers=H, json={"vinculos": [
        {"professor_id": ana.id, "horas_semanais": 4}]})).json()["criados"][0]
    for vid in (v1_ana, v1_bia, v2):
        r = await client.post(f"{URL}/vinculos/{vid}/aprovar", headers=H, json={})
        assert r.status_code == 200, r.text
    return {"admin": admin, "resp": resp, "prof_user": prof_user, "ana": ana, "bia": bia,
            "p1": p1, "p2": p2, "p3": p3, "v1_ana": v1_ana, "v2": v2, "v3": v3}


def _linha(dash, prof_id):
    return next(l for l in dash["professores"] if l["professor_id"] == prof_id)


async def test_carga_no_periodo_com_meio_do_mes_mudanca_afastamento_e_encerramento(client, db_session):
    c = await _cenario(client, db_session)
    H = _hdr(c["admin"])

    # Encerramento antecipado do Plano de curso em 10/03 (sem encerrar vínculos → alerta)
    r = await client.put(f"{URL}/projetos/{c['p2']['id']}", headers=H, json={
        "situacao": "concluido", "data_conclusao": "2026-03-10"})
    assert r.status_code == 400  # exige justificativa
    r = await client.put(f"{URL}/projetos/{c['p2']['id']}", headers=H, json={
        "situacao": "concluido", "data_conclusao": "2026-03-10", "justificativa_alteracao": "Entregue antes"})
    assert r.status_code == 200, r.text

    dash = (await client.get(f"{URL}/dashboard", headers=H, params=MARCO)).json()
    ana = _linha(dash, c["ana"].id)
    assert (ana["dias_uteis"], ana["dias_afastado"]) == (21, 5)
    assert (ana["carga_contratual"], ana["indisponivel"], ana["disponivel"]) == (168, 40, 128)
    assert (ana["regencia_prevista"], ana["regencia_realizada"]) == (6, 3)
    # P1: 16–19/03 a 2h/dia (8h) + 30–31/03 a 4h/dia (8h); P2: 02–10/03 a 1h/dia (7 dias, para na conclusão)
    assert ana["nr_prevista"] == 23
    assert ana["nr_proposta"] == 12.8          # P3 proposta: 0,8h/dia × 16 dias fora do afastamento
    assert ana["outras_alocacoes"] == 6.4      # 0,4h/dia × 16 dias
    assert ana["saldo_previsto"] == pytest.approx(128 - 6 - 23 - 6.4)
    assert ana["regencia_pct"] == round(6 / (40 * 22 / 5) * 100, 1)  # indicador de regência intacto
    tipos = {a["tipo"] for a in dash["alertas"]}
    assert "encerrado_com_alocacao" in tipos and "regencia_baixa_saldo" in tipos
    assert "vinculo_sem_entregas" in tipos   # Bia e a proposta do P3 não têm responsabilidades

    # Encerrar vínculos junto com o projeto remove o alerta
    r = await client.put(f"{URL}/projetos/{c['p2']['id']}", headers=H, json={
        "encerrar_vinculos": True, "justificativa_alteracao": "Fechamento"})
    assert r.status_code == 200
    assert next(v for v in r.json()["vinculos"] if v["id"] == c["v2"])["situacao"] == "encerrada"
    dash = (await client.get(f"{URL}/dashboard", headers=H, params=MARCO)).json()
    assert "encerrado_com_alocacao" not in {a["tipo"] for a in dash["alertas"]}
    assert _linha(dash, c["ana"].id)["nr_prevista"] == 23

    # Disponibilidade antes de aprovar a proposta do P3
    disp = (await client.get(f"{URL}/disponibilidade", headers=H, params={
        "professor_ids": str(c["ana"].id), **MARCO, "horas_semanais": 4})).json()["professores"][0]
    assert disp["horas_novas"] == 12.8 and disp["saldo_depois"] == pytest.approx(disp["saldo_antes"] - 12.8)

    # Sobrecarga: +60h/sem no mês (12h/dia × 16 dias) supera o saldo de 92,6h
    p4 = (await client.post(f"{URL}/projetos", headers=H, json={
        "nome": "Feira", "situacao": "em_andamento", "data_inicio": "2026-03-02", "data_fim_prevista": "2026-03-31"})).json()
    r = await client.post(f"{URL}/projetos/{p4['id']}/vinculos", headers=H, json={"vinculos": [
        {"professor_id": c["ana"].id, "horas_semanais": 60, "responsabilidades": "x"}]})
    await client.post(f"{URL}/vinculos/{r.json()['criados'][0]}/aprovar", headers=H, json={})
    dash = (await client.get(f"{URL}/dashboard", headers=H, params=MARCO)).json()
    assert _linha(dash, c["ana"].id)["sobrecarga"] and dash["indicadores"]["professores_sobrecarga"] >= 1

    # Histórico registra a mudança de situação com justificativa
    hist = (await client.get(f"{URL}/historico", headers=H, params={"projeto_id": c["p2"]["id"]})).json()
    assert any(h["acao"] == "situacao" and h["justificativa"] == "Entregue antes" for h in hist)


async def test_apontamentos_validacao_e_entregas(client, db_session):
    c = await _cenario(client, db_session)
    HP, HR, HA = _hdr(c["prof_user"]), _hdr(c["resp"]), _hdr(c["admin"])
    p1 = c["p1"]["id"]

    r = await client.post(f"{URL}/apontamentos", headers=HP, json={
        "projeto_id": p1, "data_inicio": "2026-03-16", "horas": 4, "descricao": "Montagem", "enviar": True})
    assert r.status_code == 200, r.text
    ap1 = r.json()["apontamento"]["id"]
    # Lançamento semanal cobrindo o mesmo dia: duplicidade bloqueada
    r = await client.post(f"{URL}/apontamentos", headers=HP, json={
        "projeto_id": p1, "data_inicio": "2026-03-16", "data_fim": "2026-03-20", "horas": 8, "descricao": "Semana"})
    assert r.status_code == 409
    r = await client.post(f"{URL}/apontamentos", headers=HP, json={
        "projeto_id": p1, "data_inicio": "2026-03-30", "data_fim": "2026-03-31", "horas": 6, "descricao": "Testes",
        "enviar": True})
    assert r.status_code == 200
    # Durante as férias: aceito como rascunho, mas sinalizado
    r = await client.post(f"{URL}/apontamentos", headers=HP, json={
        "projeto_id": p1, "data_inicio": "2026-03-24", "horas": 2, "descricao": "Leitura"})
    assert r.status_code == 200 and any("afastamento" in a for a in r.json()["avisos"])
    # Sem vínculo aprovado no projeto 3 (só proposta)
    r = await client.post(f"{URL}/apontamentos", headers=HP, json={
        "projeto_id": c["p3"]["id"], "data_inicio": "2026-03-10", "horas": 1, "descricao": "x"})
    assert r.status_code == 400

    # Ninguém valida as próprias horas; o responsável valida
    assert (await client.post(f"{URL}/apontamentos/validar", headers=HP, json={"ids": [ap1], "aprovar": True})).status_code == 403
    r = await client.post(f"{URL}/apontamentos/validar", headers=HR, json={"ids": [ap1], "aprovar": True})
    assert r.status_code == 200, r.text

    dash = (await client.get(f"{URL}/dashboard", headers=HA, params=MARCO)).json()
    ana = _linha(dash, c["ana"].id)
    assert (ana["nr_informada"], ana["nr_validada"], ana["nr_pendente"]) == (10, 4, 6)

    # Entregas: progresso pelas aprovadas e pesos
    e1 = (await client.post(f"{URL}/projetos/{p1}/entregas", headers=HR, json={
        "titulo": "Bancada montada", "responsaveis": [c["ana"].id], "prazo": "2026-04-30", "peso": 3,
        "criterio_aceite": "Bancada operando"})).json()["id"]
    await client.post(f"{URL}/projetos/{p1}/entregas", headers=HR, json={
        "titulo": "Relatório", "responsaveis": [c["ana"].id], "prazo": "2026-03-20", "peso": 1})
    assert (await client.get(f"{URL}/projetos/{p1}", headers=HA)).json()["progresso"] == 0
    assert (await client.post(f"{URL}/entregas/{e1}/submeter", headers=HP, json={})).status_code == 400  # sem evidência
    r = await client.post(f"{URL}/entregas/{e1}/submeter", headers=HP, json={"evidencias": "Fotos e checklist"})
    assert r.status_code == 200
    assert (await client.post(f"{URL}/entregas/{e1}/avaliar", headers=HR, json={"aprovar": False})).status_code == 400
    r = await client.post(f"{URL}/entregas/{e1}/avaliar", headers=HR, json={"aprovar": True, "parecer": "Ok"})
    assert r.status_code == 200
    proj = (await client.get(f"{URL}/projetos/{p1}", headers=HA)).json()
    assert proj["progresso"] == 75 and proj["entregas_atrasadas"] == 1
    assert any(h["acao"] == "aprovacao" and h["entidade"] == "entrega" for h in proj["historico"])

    # Professor vê só a própria linha e não acessa projetos de que não participa
    dash_prof = (await client.get(f"{URL}/dashboard", headers=HP, params=MARCO)).json()
    assert [l["professor_id"] for l in dash_prof["professores"]] == [c["ana"].id]
    visao = (await client.get(f"{URL}/professores/{c['ana'].id}/visao", headers=HP, params=MARCO)).json()
    assert visao["regencia"]["horas_ministradas"] == 6 and visao["carga"]["nr_validada"] == 4
    assert (await client.get(f"{URL}/professores/{c['bia'].id}/visao", headers=HP)).status_code == 403


async def test_permissoes_e_relatorios(client, db_session):
    c = await _cenario(client, db_session)
    HA = _hdr(c["admin"])
    # Gestor que também é o professor do vínculo não aprova a própria alocação
    coord = await _usuario(db_session, "coordenador", "Coord Ana")
    coord.email = c["prof_user"].email
    c["prof_user"].email = "outro@teste.com"
    await db_session.flush()
    r = await client.post(f"{URL}/vinculos/{c['v3']}/aprovar", headers=_hdr(coord), json={})
    assert r.status_code == 403 and "própria" in r.json()["detail"]
    # Responsável precisa ser administrador ou coordenador
    r = await client.post(f"{URL}/projetos", headers=HA, json={"nome": "x", "responsavel_id": c["prof_user"].id})
    assert r.status_code == 400 and "coordenador" in r.json()["detail"]
    # Professor não cria projeto
    assert (await client.post(f"{URL}/projetos", headers=_hdr(c["prof_user"]), json={"nome": "x"})).status_code == 403
    # Atividade contínua exige data de revisão
    r = await client.post(f"{URL}/projetos", headers=HA, json={
        "nome": "Coordenação", "situacao": "em_andamento", "data_inicio": "2026-03-01", "continuo": True})
    assert r.status_code == 400 and "revisão" in r.json()["detail"]

    for tipo in ("professor", "projeto", "categoria", "consolidado"):
        r = await client.get(f"{URL}/relatorios/exportar", headers=HA, params={"formato": "xlsx", "tipo": tipo, **MARCO})
        assert r.status_code == 200 and r.content[:2] == b"PK"
    r = await client.get(f"{URL}/relatorios/exportar", headers=HA, params={"formato": "pdf", **MARCO})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"

    # Parâmetros configuráveis, com decisões pendentes explícitas
    cfg = (await client.get(f"{URL}/config", headers=HA)).json()
    assert {x["chave"] for x in cfg if x["decisao_pendente"]} == {"reserva_planejamento_pct", "tipos_calendario_nao_util"}
    r = await client.put(f"{URL}/config", headers=HA, json={"reserva_planejamento_pct": "10"})
    assert r.status_code == 200
    dash = (await client.get(f"{URL}/dashboard", headers=HA, params=MARCO)).json()
    assert _linha(dash, c["ana"].id)["reserva_planejamento"] == 12.8


async def test_dashboard_com_vinculo_em_projeto_com_categoria(client, db_session):
    """Regressão: com sessão nova (como em produção), o painel quebrava ao montar projeto com categoria e vínculo."""
    admin = await _usuario(db_session, "admin", "Admin")
    prof = Professor(nome="Ana", tipo="Mensalista", horas_contratadas=40, ativo=True)
    db_session.add(prof)
    await db_session.flush()
    H = _hdr(admin)
    cat = (await client.get(f"{URL}/opcoes", headers=H)).json()["categorias"][0]["id"]
    p = (await client.post(f"{URL}/projetos", headers=H, json={
        "nome": "Teste", "situacao": "planejado", "data_inicio": "2026-08-10", "data_fim_prevista": "2026-12-15",
        "responsavel_id": admin.id, "categoria_id": cat})).json()
    r = await client.post(f"{URL}/projetos/{p['id']}/vinculos", headers=H,
                          json={"vinculos": [{"professor_id": prof.id, "horas_semanais": 4}]})
    assert r.status_code == 200
    db_session.expunge_all()
    for caminho in ("dashboard", "vinculos", "projetos"):
        r = await client.get(f"{URL}/{caminho}", headers=H, params={"ini": "2026-08-01", "fim": "2026-10-31"})
        assert r.status_code == 200, (caminho, r.text)
    dash = (await client.get(f"{URL}/dashboard", headers=H, params={"ini": "2026-08-01", "fim": "2026-10-31"})).json()
    assert dash["indicadores"]["horas_propostas"] == 48
    v = (await client.get(f"{URL}/vinculos", headers=H)).json()[0]
    db_session.expunge_all()
    assert (await client.post(f"{URL}/vinculos/{v['id']}/aprovar", headers=H, json={})).status_code == 200
    db_session.expunge_all()
    e = await client.post(f"{URL}/projetos/{p['id']}/entregas", headers=H, json={"titulo": "Relatório", "responsaveis": [prof.id]})
    assert e.status_code == 200
    db_session.expunge_all()
    periodo = {"ini": "2026-08-01", "fim": "2026-10-31"}
    for caminho, params in ((f"projetos/{p['id']}", {}), ("entregas", {}), ("apontamentos", {}), ("historico", {}),
                            (f"professores/{prof.id}/visao", periodo), ("dashboard", periodo),
                            ("relatorios/exportar", {**periodo, "formato": "pdf"}),
                            ("disponibilidade", {**periodo, "professor_ids": str(prof.id), "horas_semanais": 2})):
        db_session.expunge_all()
        r = await client.get(f"{URL}/{caminho}", headers=H, params=params)
        assert r.status_code == 200, (caminho, r.text[:300])
