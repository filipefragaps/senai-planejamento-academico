"""Testes do CRM de Leads: importação, distribuição, permissões e regras de status."""
import uuid

import pytest_asyncio

from app.core.security import create_access_token, hash_password

CSV_META = (
    "id\tcreated_time\tad_name\tadset_name\tcampaign_id\tcampaign_name\tform_name\tplatform\t"
    "qual_curso_tem_interesse?\tfull_name\tphone_number\temail\n"
    "l:111\t2026-10-15T10:00:00-03:00\tAnuncio A\tConjunto A\tc:900\tSoldagem Out\tForm 1\tig\t"
    "Soldagem MIG\tMaria Souza\tp:+5562999990001\tmaria@ex.com\n"
    "l:222\t2026-10-15T11:00:00-03:00\tAnuncio A\tConjunto A\tc:900\tSoldagem Out\tForm 1\tfb\t"
    "Soldagem TIG\tJoão Lima\tp:+5562999990002\tjoao@ex.com\n"
    "l:333\t2026-10-16T09:30:00-03:00\tAnuncio B\tConjunto B\tc:901\tCNC Out\tForm 2\tig\t"
    "CNC\tAna Reis\tp:+5562999990003\tana@ex.com\n"
).encode("utf-16")


async def _usuario(db, perfil: str, nome: str):
    from app.models.usuario import Usuario

    u = Usuario(nome=nome, email=f"{uuid.uuid4().hex[:8]}@teste.com",
                hashed_password=hash_password("Senha@123"), perfil=perfil, ativo=True)
    db.add(u)
    await db.flush()
    return u


def _hdr(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'perfil': user.perfil})}"}


@pytest_asyncio.fixture
async def vendedores(db_session):
    return [await _usuario(db_session, "vendedor", "Vendedor A"), await _usuario(db_session, "vendedor", "Vendedor B")]


async def _importar(client, admin_hdr):
    r = await client.post("/api/v1/crm/leads/importar-csv", headers=admin_hdr,
                          files={"arquivo": ("leads.csv", CSV_META, "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()


async def test_importacao_csv_distribui_e_deduplica(client, admin_user, vendedores):
    admin = _hdr(admin_user)
    res = await _importar(client, admin)
    assert res["inseridos"] == 3 and res["duplicados"] == 0

    # Reimportar o mesmo arquivo não duplica
    res2 = await _importar(client, admin)
    assert res2["inseridos"] == 0 and res2["duplicados"] == 3

    leads = (await client.get("/api/v1/crm/leads", headers=admin)).json()
    assert leads["total"] == 3
    maria = next(l for l in leads["items"] if l["nome"] == "Maria Souza")
    assert maria["telefone"] == "5562999990001"
    assert maria["campanha_nome"] == "Soldagem Out"
    assert maria["dados_extras"]["qual_curso_tem_interesse?"] == "Soldagem MIG"
    assert maria["status"] == "novo"

    # Rodízio: 3 leads entre 2 vendedores → A, B, A
    por_vendedor = sorted(l["vendedor_id"] for l in leads["items"])
    assert por_vendedor.count(vendedores[0].id) == 2
    assert por_vendedor.count(vendedores[1].id) == 1


async def test_vendedor_ve_somente_os_proprios_leads(client, admin_user, vendedores):
    await _importar(client, _hdr(admin_user))
    r = await client.get("/api/v1/crm/leads", headers=_hdr(vendedores[1]))
    assert r.status_code == 200
    itens = r.json()["items"]
    assert len(itens) == 1 and all(l["vendedor_id"] == vendedores[1].id for l in itens)

    outro = (await client.get("/api/v1/crm/leads", headers=_hdr(vendedores[0]))).json()["items"][0]
    r = await client.get(f"/api/v1/crm/leads/{outro['id']}", headers=_hdr(vendedores[1]))
    assert r.status_code == 403


async def test_outros_perfis_nao_acessam_crm(client, db_session):
    coord = await _usuario(db_session, "coordenador", "Coord")
    r = await client.get("/api/v1/crm/leads", headers=_hdr(coord))
    assert r.status_code == 403


async def test_regras_de_status_e_historico(client, admin_user, vendedores):
    await _importar(client, _hdr(admin_user))
    vend = vendedores[1]
    h = _hdr(vend)
    lead = (await client.get("/api/v1/crm/leads", headers=h)).json()["items"][0]
    url = f"/api/v1/crm/leads/{lead['id']}"

    # Vendedor não pode reatribuir lead
    assert (await client.patch(url, headers=h, json={"vendedor_id": vendedores[0].id})).status_code == 403

    # Saiu de "novo": preenche último contato automaticamente
    r = await client.patch(url, headers=h, json={"status": "em_atendimento", "temperatura": "quente"})
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["ultimo_contato"] is not None
    campos = {x["campo"] for x in corpo["historico"]}
    assert {"status", "temperatura", "criacao"} <= campos

    # Aguardando retorno exige data
    assert (await client.patch(url, headers=h, json={"status": "aguardando_retorno"})).status_code == 400

    # Perdido exige motivo; "outro" exige comentário
    assert (await client.patch(url, headers=h, json={"status": "perdido"})).status_code == 400
    assert (await client.patch(url, headers=h, json={"status": "perdido", "motivo_perda": "outro"})).status_code == 400
    r = await client.patch(url, headers=h, json={"status": "perdido", "motivo_perda": "outro",
                                                 "motivo_perda_comentario": "Mudou de cidade"})
    assert r.status_code == 200 and r.json()["finalizado"] is True

    # Lead finalizado: vendedor só anota; admin corrige
    assert (await client.patch(url, headers=h, json={"status": "em_atendimento"})).status_code == 403
    r = await client.patch(url, headers=h, json={"nota": "Ligou de novo pedindo informações"})
    assert r.status_code == 200 and r.json()["historico"][0]["campo"] == "nota"
    r = await client.patch(url, headers=_hdr(admin_user), json={"status": "aguardando_decisao"})
    assert r.status_code == 200 and r.json()["status"] == "aguardando_decisao"


async def test_matricula_e_dashboard(client, admin_user, vendedores):
    admin = _hdr(admin_user)
    await _importar(client, admin)
    leads = (await client.get("/api/v1/crm/leads", headers=admin)).json()["items"]
    url = f"/api/v1/crm/leads/{leads[0]['id']}"
    assert (await client.patch(url, headers=admin, json={"status": "matriculado"})).status_code == 400
    # Matrícula exige também o vencimento da 1ª parcela
    assert (await client.patch(url, headers=admin, json={"status": "matriculado", "data_matricula": "2026-10-18"})).status_code == 400
    r = await client.patch(url, headers=admin, json={"status": "matriculado", "data_matricula": "2026-10-18",
                                                     "vencimento_primeira_parcela": "2026-11-10"})
    assert r.status_code == 200

    d = (await client.get("/api/v1/crm/dashboard", headers=admin)).json()
    assert d["total"] == 3
    assert d["matriculados"] == 1
    assert d["taxa_conversao"] == 33.3
    assert {c["nome"] for c in d["por_campanha"]} == {"Soldagem Out", "CNC Out"}
    # Leads de 15 e 16/10/2026 estão há mais de 2h em "novo"
    assert d["novos_sem_atendimento"] == 2

    # Filtro de período (datas no fuso de Brasília)
    d16 = (await client.get("/api/v1/crm/dashboard", headers=admin,
                            params={"data_inicio": "2026-10-16", "data_fim": "2026-10-16"})).json()
    assert d16["total"] == 1


async def test_campanha_com_oferta_e_vendedor_padrao(client, db_session, admin_user, vendedores):
    from app.models.oferta import OfertaCurso

    oferta = OfertaCurso(codigo_evento="1089644", modalidade="Qualificação", nome_curso="Soldagem MIG MAG")
    db_session.add(oferta)
    await db_session.flush()
    admin = _hdr(admin_user)

    r = await client.post("/api/v1/crm/campanhas", headers=admin,
                          json={"nome": "Soldagem Out", "oferta_id": oferta.id, "vendedor_padrao_id": vendedores[1].id})
    assert r.status_code == 201, r.text
    await _importar(client, admin)

    leads = (await client.get("/api/v1/crm/leads", headers=admin, params={"campanha_id": r.json()["id"]})).json()["items"]
    assert len(leads) == 2
    assert all(l["vendedor_id"] == vendedores[1].id for l in leads)
    assert all(l["oferta_label"] == "1089644 – Soldagem MIG MAG" for l in leads)


# Export da Central de Leads em português: sem campanha, data americana, telefone em 3 colunas
CSV_CENTRAL_LEADS = (
    "Criado em,Nome,Email,Fonte,Formulário,Canal,Estágio,Proprietário,Rótulos,Telefone,"
    "Número de telefone secundário,Número do WhatsApp\n"
    "10/20/2026 4:57pm,Carla Dias,,Pago,Instrumentação Industrial (v5),,Em análise,Unassigned,,,,+5562988887777\n"
    "10/20/2026 9:05am,Bruno Alves,,Pago,Instrumentação Industrial (v4),Telefone,Em análise,Unassigned,,(62) 99999-1111,,\n"
    "09/21/2026 6:38pm,Diego Rocha,,Pago,Formulário SEP-copy,,Em análise,Unassigned,,,,\n"
).encode("utf-8")


async def test_importacao_central_de_leads_pt(client, admin_user, vendedores):
    admin = _hdr(admin_user)
    r = await client.post("/api/v1/crm/leads/importar-csv", headers=admin,
                          files={"arquivo": ("leads.csv", CSV_CENTRAL_LEADS, "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json()["inseridos"] == 3

    itens = {l["nome"]: l for l in (await client.get("/api/v1/crm/leads", headers=admin)).json()["items"]}
    # WhatsApp usado quando "Telefone" está vazio
    assert itens["Carla Dias"]["telefone"] == "5562988887777"
    assert itens["Bruno Alves"]["telefone"] == "62999991111"
    # Data americana com am/pm, no fuso de Brasília (16:57 BRT = 19:57 UTC)
    assert itens["Carla Dias"]["recebido_em"].startswith("2026-10-20T19:57")
    assert itens["Bruno Alves"]["recebido_em"].startswith("2026-10-20T12:05")
    # Sem coluna de campanha: formulário vira campanha, versões (v4)/(v5) agrupadas
    assert itens["Carla Dias"]["campanha_nome"] == itens["Bruno Alves"]["campanha_nome"] == "Instrumentação Industrial"
    assert itens["Carla Dias"]["formulario"] == "Instrumentação Industrial (v5)"
    # Colunas internas da Meta não poluem as respostas extras
    assert "Estágio" not in itens["Carla Dias"]["dados_extras"]
    assert itens["Carla Dias"]["dados_extras"]["Fonte"] == "Pago"

    # Reimportar não duplica, mesmo o lead sem telefone nem e-mail (Diego)
    r2 = await client.post("/api/v1/crm/leads/importar-csv", headers=admin,
                           files={"arquivo": ("leads.csv", CSV_CENTRAL_LEADS, "text/csv")})
    assert r2.json()["inseridos"] == 0 and r2.json()["duplicados"] == 3


async def test_primeira_parcela_alertas_e_pagamento(client, admin_user, vendedores):
    from datetime import timedelta
    from app.services.crm import hoje_br

    await _importar(client, _hdr(admin_user))
    vend = vendedores[0]
    h = _hdr(vend)
    leads = (await client.get("/api/v1/crm/leads", headers=h)).json()["items"]
    hoje = hoje_br()
    a_vencer, vencida = leads[0], leads[1]

    for lead, venc in ((a_vencer, hoje + timedelta(days=2)), (vencida, hoje - timedelta(days=1))):
        r = await client.patch(f"/api/v1/crm/leads/{lead['id']}", headers=h, json={
            "status": "matriculado", "data_matricula": hoje.isoformat(),
            "vencimento_primeira_parcela": venc.isoformat()})
        assert r.status_code == 200, r.text

    assert "parcela_a_vencer" in (await client.get(f"/api/v1/crm/leads/{a_vencer['id']}", headers=h)).json()["alertas"]
    lv = (await client.get(f"/api/v1/crm/leads/{vencida['id']}", headers=h)).json()
    assert "parcela_vencida" in lv["alertas"] and lv["parcela_pendente"] is True

    filtro = (await client.get("/api/v1/crm/leads", headers=h, params={"alerta": "parcela_vencida"})).json()
    assert [l["id"] for l in filtro["items"]] == [vencida["id"]]
    d = (await client.get("/api/v1/crm/dashboard", headers=h)).json()
    assert d["parcelas_a_vencer"] == 1 and d["parcelas_vencidas"] == 1 and d["matriculas_aguardando_pagamento"] == 2

    # Lead finalizado: vendedor ainda registra o pagamento, mas não muda o status
    url = f"/api/v1/crm/leads/{vencida['id']}"
    assert (await client.patch(url, headers=h, json={"status": "perdido", "motivo_perda": "preco"})).status_code == 403
    r = await client.patch(url, headers=h, json={"parcela_paga_em": hoje.isoformat()})
    assert r.status_code == 200, r.text
    pago = r.json()
    assert pago["alertas"] == [] and pago["parcela_pendente"] is False
    assert any(x["campo"] == "parcela_paga_em" for x in pago["historico"])
    d = (await client.get("/api/v1/crm/dashboard", headers=h)).json()
    assert d["matriculas_pagas"] == 1 and d["parcelas_vencidas"] == 0

    # Pagamento só para matriculado
    admin = _hdr(admin_user)
    novo = (await client.get("/api/v1/crm/leads", headers=admin, params={"status": "novo"})).json()["items"][0]
    r = await client.patch(f"/api/v1/crm/leads/{novo['id']}", headers=admin, json={"parcela_paga_em": hoje.isoformat()})
    assert r.status_code == 400
