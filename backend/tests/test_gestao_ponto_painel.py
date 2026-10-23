"""Painel da Gestão de Ponto v1.5: snapshot no banco, status por item e migração dos status antigos."""
import gzip
import json
import uuid

import pytest_asyncio

from app.core.security import create_access_token, hash_password


@pytest_asyncio.fixture
async def rh(db_session):
    from app.models.usuario import Usuario
    u = Usuario(nome="RH Teste", email=f"rh_{uuid.uuid4().hex[:6]}@t.com", hashed_password=hash_password("x"), perfil="rh", ativo=True)
    db_session.add(u)
    await db_session.flush()
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id)})}"}


def _snapshot(items):
    return {"analysisVersion": 18, "data": {
        "contacts": [{"matricula": "1", "nome": "Ana"}], "inactiveMatriculas": [], "baseFileName": "base.csv",
        "unitName": "FATEC", "fileName": "10 arquivos", "items": items,
        "result": {"period": "01/01/2026 a 22/10/2026", "occurrences": items, "days": [], "balances": [],
                   "monthlyBalances": [], "sourceFiles": []},
    }}


async def test_painel_fluxo_completo(client, db_session, rh):
    from app.models.gestao_ponto import GpOcorrencia

    # Sem dados ainda
    r = await client.get("/api/v1/gestao-ponto/painel", headers=rh)
    assert r.status_code == 200 and r.json()["snapshot"] is None and r.json()["access"]["canManage"] is True

    # Status já registrado na versão anterior é aproveitado na 1ª gravação
    db_session.add(GpOcorrencia(occurrence_id="1-21/10/2026-Ausência de batida-0", matricula="1", collaborator="Ana",
                                date_display="21/10/2026", date_key="20261021", category="Ausência de batida", status="approved"))
    await db_session.flush()
    itens = [{"id": "1-21/10/2026-Ausência de batida-0", "status": "pending"}, {"id": "1-22/10/2026-Falta-1", "status": "pending"}]

    # A tela grava primeiro a base FPW (sem ocorrências) e depois os TXT mensais
    so_base = _snapshot([])
    so_base["data"]["result"] = None
    assert (await client.post("/api/v1/gestao-ponto/painel", headers=rh, json=so_base)).json()["statusAproveitados"] == 0

    # Corpo compactado (como o navegador envia)
    corpo = gzip.compress(json.dumps(_snapshot(itens)).encode())
    r = await client.post("/api/v1/gestao-ponto/painel", content=corpo,
                          headers={**rh, "Content-Type": "application/json", "Content-Encoding": "gzip"})
    assert r.status_code == 200, r.text
    assert r.json()["statusAproveitados"] == 1 and r.json()["snapshot"]["analysisVersion"] == 18

    snap = (await client.get("/api/v1/gestao-ponto/painel", headers=rh)).json()["snapshot"]
    assert snap["data"]["baseFileName"] == "base.csv" and snap["updatedByEmail"].startswith("rh_")
    assert [i["status"] for i in snap["data"]["items"]] == ["approved", "pending"]

    # Mudança de status só do item
    r = await client.patch("/api/v1/gestao-ponto/painel/itens", headers=rh, json={"changes": [
        {"id": "1-22/10/2026-Falta-1", "status": "approved", "notifiedAt": "2026-10-23T10:00:00Z", "notificationMethod": "outlook-web"},
        {"id": "1-21/10/2026-Ausência de batida-0", "status": "pending"},
    ]})
    assert r.status_code == 200 and r.json()["alterados"] == 2
    itens = (await client.get("/api/v1/gestao-ponto/painel", headers=rh)).json()["snapshot"]["data"]["items"]
    assert itens[1] == {"id": "1-22/10/2026-Falta-1", "status": "approved", "notifiedAt": "2026-10-23T10:00:00Z",
                        "notificationMethod": "outlook-web"}
    assert itens[0] == {"id": "1-21/10/2026-Ausência de batida-0", "status": "pending"}

    # E-mail do RH compartilhado
    assert (await client.put("/api/v1/gestao-ponto/painel/config", headers=rh, json={"rhEmail": "invalido"})).status_code == 400
    await client.put("/api/v1/gestao-ponto/painel/config", headers=rh, json={"rhEmail": "RH-IB.Comunica@fieg.com.br"})
    assert (await client.get("/api/v1/gestao-ponto/painel", headers=rh)).json()["rhEmail"] == "rh-ib.comunica@fieg.com.br"


async def test_painel_permissoes_e_validacao(client, db_session, rh):
    from app.models.usuario import Usuario
    v = Usuario(nome="Vend", email=f"v_{uuid.uuid4().hex[:6]}@t.com", hashed_password=hash_password("x"), perfil="vendedor", ativo=True)
    db_session.add(v)
    await db_session.flush()
    outro = {"Authorization": f"Bearer {create_access_token({'sub': str(v.id)})}"}
    assert (await client.get("/api/v1/gestao-ponto/painel", headers=outro)).status_code == 403
    assert (await client.post("/api/v1/gestao-ponto/painel", headers=rh, json={"data": {}})).status_code == 400
    r = await client.post("/api/v1/gestao-ponto/painel", content=b"nao-json", headers={**rh, "Content-Type": "application/json"})
    assert r.status_code == 400
