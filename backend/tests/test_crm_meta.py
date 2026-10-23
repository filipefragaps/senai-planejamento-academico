"""Integração com a Meta (Lead Ads): webhook, sincronização e conversão — Graph API simulada."""
import hashlib
import hmac
import json
import uuid

import httpx
import pytest
import pytest_asyncio

from app.config import settings
from app.core.security import create_access_token, hash_password
from app.services import meta_leads

TOKEN = "TOKEN-SISTEMA-SECRETO"
TOKEN_PAGINA = "TOKEN-PAGINA-SECRETO"
SEGREDO = "segredo-do-app"
PAGINA = "1234567890"

LEAD_ANUNCIO = {
    "id": "900001",
    "created_time": "2026-10-20T19:57:41+0000",
    "ad_name": "Anúncio CNC", "adset_name": "Goiânia 18-45", "campaign_id": "c77",
    "campaign_name": "CNC Outubro", "form_id": "f1", "platform": "ig", "is_organic": False,
    "field_data": [
        {"name": "full_name", "values": ["Ana Reis"]},
        {"name": "phone_number", "values": ["+5562999990003"]},
        {"name": "email", "values": ["ana@ex.com"]},
        {"name": "qual_turno_prefere?", "values": ["Noite"]},
    ],
}
LEAD_ORGANICO = {
    "id": "900002",
    "created_time": "2026-10-21T12:00:00+0000",
    "form_id": "f2", "platform": "fb", "is_organic": True,
    "field_data": [
        {"name": "first_name", "values": ["Bruno"]},
        {"name": "last_name", "values": ["Lima"]},
        {"name": "whatsapp_number", "values": ["+5562988887777"]},
    ],
}
FORMS = {"f1": "Formulário CNC (v2)", "f2": "Instrumentação Industrial (v5)"}


class GraphFalsa:
    """Responde como a Graph API e registra as chamadas para conferência."""

    def __init__(self):
        self.chamadas: list[httpx.Request] = []
        self.assinado = False
        self.erro: dict | None = None
        # Como a Meta entrega o token da página: "contas" (/me/accounts), "campo" (access_token da página)
        # ou "nenhum" (o token informado já é de página: os dois caminhos respondem erro #100)
        self.modo_token = "contas"
        self.webhook_app: dict | None = None   # assinatura do objeto "page" no app

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.chamadas.append(req)
        if self.erro:
            return httpx.Response(400, json={"error": self.erro})
        caminho = req.url.path.split("/", 2)[-1]  # remove "/v23.0/"
        p = req.url.params
        erro_campo = {"error": {"message": "(#100) Tried accessing nonexisting field (access_token)", "code": 100}}
        if caminho == PAGINA:
            if "access_token" in p.get("fields", ""):
                if self.modo_token != "campo":
                    return httpx.Response(400, json=erro_campo)
                return httpx.Response(200, json={"id": PAGINA, "access_token": TOKEN_PAGINA})
            return httpx.Response(200, json={"id": PAGINA, "name": "SENAI Teste"})
        if caminho == "me/accounts":
            if self.modo_token != "contas":
                return httpx.Response(400, json=erro_campo)
            return httpx.Response(200, json={"data": [{"id": "999", "name": "Outra Página", "access_token": "OUTRA"},
                                                      {"id": PAGINA, "name": "SENAI Teste", "access_token": TOKEN_PAGINA}]})
        if caminho == "app":
            return httpx.Response(200, json={"id": "app42", "name": "CRM SENAI"})
        if caminho == "app42/subscriptions":
            assert req.headers["Authorization"] == f"Bearer app42|{SEGREDO}" and "appsecret_proof" not in p
            if req.method == "POST":
                self.webhook_app = {"object": "page", "callback_url": p["callback_url"], "active": True,
                                    "fields": [{"name": f, "version": "v23.0"} for f in p["fields"].split(",")]}
                return httpx.Response(200, json={"success": True})
            return httpx.Response(200, json={"data": [self.webhook_app] if self.webhook_app else []})
        if caminho == "me":
            return httpx.Response(200, json={"id": "777", "name": "Usuário do sistema CRM", "metadata": {"type": "user"}})
        if caminho == "555":  # ID errado: perfil pessoal em vez de página
            return httpx.Response(200, json={"id": "555", "name": "Perfil Pessoal", "metadata": {"type": "user"}})
        if caminho == "555/leadgen_forms":
            return httpx.Response(400, json={"error": {"message": "(#100) Tried accessing nonexisting field (leadgen_forms)", "code": 100}})
        if caminho == f"{PAGINA}/leadgen_forms":
            if p.get("after") == "cur1":
                return httpx.Response(200, json={"data": [{"id": "f2", "name": FORMS["f2"], "status": "ACTIVE"}]})
            return httpx.Response(200, json={
                "data": [{"id": "f1", "name": FORMS["f1"], "status": "ACTIVE"}],
                "paging": {"cursors": {"after": "cur1"}, "next": "https://graph.facebook.com/next?access_token=x"},
            })
        if caminho == "f1/leads":
            return httpx.Response(200, json={"data": [LEAD_ANUNCIO]})
        if caminho == "f2/leads":
            return httpx.Response(200, json={"data": [LEAD_ORGANICO]})
        if caminho in FORMS:
            return httpx.Response(200, json={"id": caminho, "name": FORMS[caminho]})
        if caminho == "900001":
            return httpx.Response(200, json=LEAD_ANUNCIO)
        if caminho == "900002":
            return httpx.Response(200, json=LEAD_ORGANICO)
        if caminho == f"{PAGINA}/subscribed_apps":
            if req.method == "POST":
                self.assinado = True
                return httpx.Response(200, json={"success": True})
            campos = ["leadgen"] if self.assinado else []
            return httpx.Response(200, json={"data": [{"id": "app1", "subscribed_fields": campos}]})
        return httpx.Response(404, json={"error": {"message": f"rota não simulada: {caminho}", "code": 100}})


@pytest.fixture
def graph(monkeypatch):
    falsa = GraphFalsa()
    monkeypatch.setattr(meta_leads, "_transporte", httpx.MockTransport(falsa))
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", TOKEN)
    monkeypatch.setattr(settings, "META_APP_SECRET", SEGREDO)
    monkeypatch.setattr(settings, "META_PAGE_ID", PAGINA)
    monkeypatch.setattr(settings, "META_VERIFY_TOKEN", "verifica-123")
    return falsa


@pytest_asyncio.fixture
async def vendedor(db_session):
    from app.models.usuario import Usuario
    u = Usuario(nome="Vendedor Meta", email=f"{uuid.uuid4().hex[:8]}@t.com",
                hashed_password=hash_password("x"), perfil="vendedor", ativo=True)
    db_session.add(u)
    await db_session.flush()
    return u


def _assinar(corpo: bytes) -> str:
    return "sha256=" + hmac.new(SEGREDO.encode(), corpo, hashlib.sha256).hexdigest()


def _aviso(leadgen_id: str, form_id: str) -> bytes:
    return json.dumps({"object": "page", "entry": [{"id": PAGINA, "changes": [
        {"field": "leadgen", "value": {"leadgen_id": leadgen_id, "form_id": form_id, "page_id": PAGINA}}
    ]}]}).encode()


# ── Conversão ────────────────────────────────────────────────────────────────

def test_converter_lead_anuncio_e_organico():
    a = meta_leads.converter_lead(LEAD_ANUNCIO, FORMS["f1"])
    assert a["nome"] == "Ana Reis" and a["telefone"] == "+5562999990003" and a["email"] == "ana@ex.com"
    assert a["campanha"] == "CNC Outubro" and a["formulario"] == "Formulário CNC (v2)"
    assert a["dados_extras"] == {"qual_turno_prefere?": "Noite"}
    assert a["recebido_em"].isoformat().startswith("2026-10-20T19:57:41")

    o = meta_leads.converter_lead(LEAD_ORGANICO, FORMS["f2"])
    assert o["nome"] == "Bruno Lima"
    assert o["telefone"] == "+5562988887777"           # WhatsApp quando não há telefone
    assert o["campanha"] == "Instrumentação Industrial"  # orgânico: formulário sem "(v5)"
    assert o["dados_extras"]["Origem"] == "Orgânico"


# ── Webhook ──────────────────────────────────────────────────────────────────

async def test_webhook_verificacao(client, graph):
    ok = await client.get("/api/v1/crm/webhook/meta",
                          params={"hub.mode": "subscribe", "hub.verify_token": "verifica-123", "hub.challenge": "42"})
    assert ok.status_code == 200 and ok.text == "42"
    ruim = await client.get("/api/v1/crm/webhook/meta",
                            params={"hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "42"})
    assert ruim.status_code == 403


async def test_webhook_cria_lead_e_nao_duplica(client, graph, vendedor):
    corpo = _aviso("900001", "f1")
    sem_assinatura = await client.post("/api/v1/crm/webhook/meta", content=corpo)
    assert sem_assinatura.status_code == 403
    adulterado = await client.post("/api/v1/crm/webhook/meta", content=corpo,
                                   headers={"X-Hub-Signature-256": _assinar(b"outro corpo")})
    assert adulterado.status_code == 403

    r = await client.post("/api/v1/crm/webhook/meta", content=corpo, headers={"X-Hub-Signature-256": _assinar(corpo)})
    assert r.status_code == 200 and r.json()["inseridos"] == 1, r.text
    r2 = await client.post("/api/v1/crm/webhook/meta", content=corpo, headers={"X-Hub-Signature-256": _assinar(corpo)})
    assert r2.json()["inseridos"] == 0 and r2.json()["duplicados"] == 1

    # Segredos nunca na URL: token no cabeçalho + appsecret_proof
    for req in graph.chamadas:
        assert TOKEN not in str(req.url) and TOKEN_PAGINA not in str(req.url)
        assert req.headers["Authorization"].startswith("Bearer ")
        assert "appsecret_proof" in req.url.params
    # Lead da página usa o token da página
    assert graph.chamadas[-1].headers["Authorization"] == f"Bearer {TOKEN_PAGINA}"


async def test_webhook_lead_aparece_no_crm(client, graph, vendedor, admin_user):
    corpo = _aviso("900001", "f1")
    await client.post("/api/v1/crm/webhook/meta", content=corpo, headers={"X-Hub-Signature-256": _assinar(corpo)})
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    lead = (await client.get("/api/v1/crm/leads", headers=h)).json()["items"][0]
    assert lead["nome"] == "Ana Reis" and lead["origem"] == "meta" and lead["meta_lead_id"] == "900001"
    assert lead["telefone"] == "5562999990003" and lead["campanha_nome"] == "CNC Outubro"
    assert lead["anuncio"] == "Anúncio CNC" and lead["plataforma"] == "ig"
    assert lead["vendedor_id"] == vendedor.id


async def test_webhook_erro_da_meta_responde_200(client, graph):
    graph.erro = {"message": "Invalid OAuth access token", "code": 190}
    corpo = _aviso("900001", "f1")
    r = await client.post("/api/v1/crm/webhook/meta", content=corpo, headers={"X-Hub-Signature-256": _assinar(corpo)})
    assert r.status_code == 200 and r.json() == {"ok": False}


# ── Sincronização e rotas de administração ───────────────────────────────────

async def test_sincronizar_pagina_formularios_e_nao_duplica_csv(client, graph, admin_user, vendedor):
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    # Lead já importado por CSV sem id da Meta. A conta de anúncios está em outro fuso: o CSV mostra 7:57pm,
    # lido como horário de Brasília (22:57 UTC), enquanto a API informa 19:57 UTC → 3h de diferença
    csv = ("Criado em,Nome,Formulário,Telefone\n"
           "10/20/2026 7:57pm,Ana Reis,Formulário CNC (v2),(62) 99999-0003\n").encode()
    r = await client.post("/api/v1/crm/leads/importar-csv", headers=h, files={"arquivo": ("l.csv", csv, "text/csv")})
    assert r.json()["inseridos"] == 1

    r = await client.post("/api/v1/crm/meta/sincronizar", headers=h)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["formularios"] == 2          # paginação por cursor
    assert res["recebidos"] == 2
    assert res["inseridos"] == 1 and res["duplicados"] == 1   # Ana já veio do CSV

    st = (await client.get("/api/v1/crm/meta/status", headers=h)).json()
    assert st["configurado"] is True and st["variaveis"]["META_APP_SECRET"] is True
    assert st["ultimo_resultado"]["inseridos"] == 1 and st["ultima_sincronizacao"]
    assert st["webhook_url"].endswith("/api/v1/crm/webhook/meta")
    assert TOKEN not in json.dumps(st)


async def test_testar_e_assinar(client, graph, admin_user):
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    t = (await client.post("/api/v1/crm/meta/testar", headers=h)).json()
    assert t["pagina"]["nome"] == "SENAI Teste" and len(t["formularios"]) == 2 and t["webhook_assinado"] is False
    assert (await client.post("/api/v1/crm/meta/assinar", headers=h)).json() == {"assinado": True}
    assert (await client.post("/api/v1/crm/meta/testar", headers=h)).json()["webhook_assinado"] is True


async def test_erro_da_meta_sem_vazar_token(client, graph, admin_user):
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    graph.erro = {"message": "Invalid OAuth access token", "code": 190}
    r = await client.post("/api/v1/crm/meta/testar", headers=h)
    assert r.status_code == 502 and "código 190" in r.json()["detail"]
    assert TOKEN not in r.text
    st = (await client.get("/api/v1/crm/meta/status", headers=h)).json()
    assert "Invalid OAuth" in st["ultimo_erro"]["mensagem"]


async def test_nao_configurado(client, admin_user, monkeypatch):
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "")
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    assert (await client.post("/api/v1/crm/meta/sincronizar", headers=h)).status_code == 400
    assert (await client.get("/api/v1/crm/meta/status", headers=h)).json()["configurado"] is False



@pytest.mark.parametrize("modo,token_esperado", [("contas", TOKEN_PAGINA), ("campo", TOKEN_PAGINA), ("nenhum", TOKEN)])
async def test_token_da_pagina_por_qualquer_caminho(client, graph, admin_user, modo, token_esperado):
    """Erro #100 'nonexisting field (access_token)' não pode impedir a conexão."""
    graph.modo_token = modo
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    r = await client.post("/api/v1/crm/meta/testar", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["pagina"]["nome"] == "SENAI Teste" and len(r.json()["formularios"]) == 2
    # Os formulários foram lidos com o token esperado
    forms = [c for c in graph.chamadas if c.url.path.endswith("/leadgen_forms")]
    assert forms and all(c.headers["Authorization"] == f"Bearer {token_esperado}" for c in forms)



async def test_id_que_nao_e_pagina_mostra_diagnostico(client, graph, admin_user, monkeypatch):
    monkeypatch.setattr(settings, "META_PAGE_ID", "555")
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    r = await client.post("/api/v1/crm/meta/testar", headers=h)
    assert r.status_code == 502
    corpo = r.json()
    assert "leadgen_forms" in corpo["detail"] and "META_PAGE_ID" in corpo["detail"]
    d = corpo["diagnostico"]
    assert d["id_informado"] == {"id": "555", "nome": "Perfil Pessoal", "tipo": "user"}
    assert d["dono_do_token"]["nome"] == "Usuário do sistema CRM"
    assert {"id": PAGINA, "nome": "SENAI Teste"} in d["paginas"]
    assert TOKEN not in r.text and TOKEN_PAGINA not in r.text and "OUTRA" not in r.text



async def test_cadastrar_webhook_do_app(client, graph, admin_user):
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(admin_user.id)})}"}
    https = {**h, "X-Forwarded-Proto": "https"}

    t = (await client.post("/api/v1/crm/meta/testar", headers=https)).json()
    assert t["webhook_app"]["app"]["nome"] == "CRM SENAI" and t["webhook_app"]["leadgen"] is False

    # Só aceita https (a Meta recusa http)
    assert (await client.post("/api/v1/crm/meta/webhook-app", headers=h)).status_code == 400

    r = await client.post("/api/v1/crm/meta/webhook-app", headers=https)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["cadastrado"] is True and corpo["url"] == "https://test/api/v1/crm/webhook/meta"
    assert corpo["webhook"] == {"url": "https://test/api/v1/crm/webhook/meta", "ativo": True, "leadgen": True}
    assert SEGREDO not in r.text

    t = (await client.post("/api/v1/crm/meta/testar", headers=https)).json()
    assert t["webhook_app"]["leadgen"] is True and t["webhook_app"]["url_correta"] is True
