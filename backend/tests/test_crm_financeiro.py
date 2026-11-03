"""CRM: investimento (Meta Insights ou manual), CPL/CPA/ROAS/ROI e dias do lead na etapa atual."""
import json
from datetime import date, timedelta

import httpx
import pytest

from app.config import settings
from app.models.crm import CrmCampanha, CrmHistorico, CrmLead
from app.models.oferta import OfertaCurso
from app.services import crm as svc
from app.services import meta_leads
from tests.test_crm import _hdr, _usuario

HOJE = svc.hoje_br()
D1, D2 = HOJE - timedelta(days=5), HOJE - timedelta(days=4)


@pytest.fixture
def insights(monkeypatch):
    """Graph API falsa: só o endpoint de Insights da campanha c77."""
    chamadas = []

    def responder(req: httpx.Request) -> httpx.Response:
        chamadas.append(req)
        assert req.url.path.endswith("/c77/insights")
        faixa = json.loads(req.url.params["time_range"])
        assert req.url.params["fields"] == "spend" and req.url.params["time_increment"] == "1"
        assert faixa["until"] == HOJE.isoformat()
        return httpx.Response(200, json={"data": [
            {"date_start": D1.isoformat(), "date_stop": D1.isoformat(), "spend": "100.00"},
            {"date_start": D2.isoformat(), "date_stop": D2.isoformat(), "spend": "150.00"},
        ]})

    monkeypatch.setattr(meta_leads, "_transporte", httpx.MockTransport(responder))
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "TOKEN")
    monkeypatch.setattr(settings, "META_PAGE_ID", "123")
    monkeypatch.setattr(settings, "META_APP_SECRET", "")
    return chamadas


async def _lead(db, nome, campanha, oferta=None, pago=False, matriculado=False, dias=1):
    lead = CrmLead(nome=nome, campanha_id=campanha.id, oferta_id=oferta.id if oferta else None,
                   recebido_em=svc.agora() - timedelta(days=dias),
                   status="matriculado" if (matriculado or pago) else "novo",
                   data_matricula=HOJE if (matriculado or pago) else None,
                   parcela_paga_em=HOJE if pago else None)
    db.add(lead)
    await db.flush()
    return lead


async def test_indicadores_de_investimento_e_retorno(client, db_session, insights):
    admin = await _usuario(db_session, "admin", "Admin CRM")
    vendedor = await _usuario(db_session, "vendedor", "Vendedor")
    cnc = OfertaCurso(codigo_evento="E1", modalidade="Presencial", nome_curso="CNC", valor_individual=1000)
    solda = OfertaCurso(codigo_evento="E2", modalidade="Presencial", nome_curso="Solda", valor_individual=500)
    db_session.add_all([cnc, solda])
    await db_session.flush()
    meta = CrmCampanha(nome="CNC Meta", meta_campaign_id="c77", oferta_id=cnc.id)
    manual = CrmCampanha(nome="Solda Manual", investimento_manual=300)
    db_session.add_all([meta, manual])
    await db_session.flush()
    # CNC: 4 leads, 2 matrículas pagas (oferta pela campanha) e 1 aguardando pagamento (não conta)
    await _lead(db_session, "A", meta, pago=True)
    await _lead(db_session, "B", meta, pago=True)
    await _lead(db_session, "C", meta, matriculado=True)
    await _lead(db_session, "D", meta)
    # Solda: 2 leads, 1 paga com a oferta no lead
    await _lead(db_session, "E", manual, oferta=solda, pago=True)
    await _lead(db_session, "F", manual)

    r = await client.post("/api/v1/crm/meta/gastos/sincronizar", headers=_hdr(admin))
    assert r.status_code == 200, r.text
    assert r.json()["valor_lido"] == 250 and len(insights) == 1

    fin = (await client.get("/api/v1/crm/dashboard", headers=_hdr(admin))).json()["financeiro"]
    camp = {c["nome"]: c for c in fin["por_campanha"]}
    assert camp["CNC Meta"] | {} == {**camp["CNC Meta"], "fonte_investimento": "meta", "investimento": 250,
                                     "receita": 2000, "leads": 4, "matriculas_pagas": 2,
                                     "cpl": 62.5, "cpa": 125, "roas": 8.0, "roi": 700.0}
    assert (camp["Solda Manual"]["fonte_investimento"], camp["Solda Manual"]["cpl"], camp["Solda Manual"]["cpa"],
            camp["Solda Manual"]["roas"], camp["Solda Manual"]["roi"]) == ("manual", 150, 300, 1.67, 66.7)
    assert (fin["investimento"], fin["receita"], fin["leads"], fin["matriculas_pagas"]) == (550, 2500, 6, 3)
    assert (fin["cpl"], fin["cpa"], fin["roas"], fin["roi"]) == (91.67, 183.33, 4.55, 354.5)

    # Período: só o gasto do 2º dia entra
    fin = (await client.get("/api/v1/crm/dashboard", headers=_hdr(admin),
                            params={"campanha_id": meta.id, "data_inicio": D2.isoformat()})).json()["financeiro"]
    assert fin["investimento"] == 150

    # Ressincronizar não duplica os dias
    await client.post("/api/v1/crm/meta/gastos/sincronizar", headers=_hdr(admin))
    fin = (await client.get("/api/v1/crm/dashboard", headers=_hdr(admin))).json()["financeiro"]
    assert fin["investimento"] == 550

    # Valor manual editável na campanha; vendedor não vê o financeiro
    r = await client.put(f"/api/v1/crm/campanhas/{manual.id}", headers=_hdr(admin), json={"investimento_manual": 400})
    assert r.status_code == 200 and r.json()["investimento_manual"] == 400
    assert (await client.get("/api/v1/crm/dashboard", headers=_hdr(vendedor))).json()["financeiro"] is None


async def test_dias_do_lead_na_etapa(client, db_session):
    admin = await _usuario(db_session, "admin", "Admin CRM")
    camp = CrmCampanha(nome="Camp")
    db_session.add(camp)
    await db_session.flush()
    parado = await _lead(db_session, "Parado", camp, dias=10)
    mudou = await _lead(db_session, "Mudou", camp, dias=10)
    db_session.add(CrmHistorico(lead_id=mudou.id, campo="status", valor_anterior="Novo lead",
                                valor_novo="Em atendimento", criado_em=svc.agora() - timedelta(days=3)))
    await db_session.flush()

    itens = {l["nome"]: l for l in (await client.get("/api/v1/crm/leads", headers=_hdr(admin))).json()["items"]}
    assert itens["Parado"]["dias_na_etapa"] == 10
    assert itens["Mudou"]["dias_na_etapa"] == 3
    detalhe = (await client.get(f"/api/v1/crm/leads/{mudou.id}", headers=_hdr(admin))).json()
    assert detalhe["dias_na_etapa"] == 3

    # Mudar a etapa zera a contagem
    r = await client.patch(f"/api/v1/crm/leads/{parado.id}", headers=_hdr(admin),
                           json={"status": "tentativa_contato"})
    assert r.status_code == 200, r.text
    assert r.json()["dias_na_etapa"] == 0
