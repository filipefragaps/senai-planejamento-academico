"""
Integração do CRM com a Meta (Lead Ads) via Graph API.

- Webhook: a Meta avisa cada lead novo (campo `leadgen`); buscamos os dados completos e criamos o lead.
- Sincronização de segurança: lê os formulários da página e os leads recentes, sem duplicar.

Os segredos (token, chave secreta) vêm só das variáveis de ambiente e nunca são gravados em log:
o token vai no cabeçalho Authorization (não na URL) e a paginação usa cursores, não as URLs `next`.
"""
import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services import crm as svc

log = logging.getLogger("crm.meta")

CAMPOS_LEAD = "id,created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic"
DIAS_PRIMEIRA_SYNC = 90      # a Meta mantém os leads por 90 dias
HORAS_SOBREPOSICAO = 48      # cada sincronização relê as últimas 48h para cobrir falhas do webhook

# Permite injetar um transporte falso nos testes (httpx.MockTransport)
_transporte: httpx.AsyncBaseTransport | None = None


class MetaErro(Exception):
    """Erro devolvido pela Graph API (mensagem já legível, sem dados sensíveis)."""


def _dica(codigo, mensagem: str) -> str:
    """Orientação em português para os erros mais comuns da Graph API."""
    m = (mensagem or "").lower()
    if codigo == 190:
        return "Token inválido ou expirado: gere um novo token do usuário do sistema e atualize META_ACCESS_TOKEN."
    if codigo in (10, 200) or "permission" in m:
        return ("Permissão faltando: o token precisa de leads_retrieval, pages_show_list, pages_read_engagement, "
                "pages_manage_metadata, pages_manage_ads e ads_read, e o usuário do sistema precisa ter a página atribuída.")
    if codigo == 100 and ("leadgen_forms" in m or "nonexisting field" in m) and "access_token" not in m:
        return "Confira META_PAGE_ID: ele deve ser o ID da Página do Facebook (não do app, do portfólio nem da conta de anúncios)."
    if codigo == 803 or "do not exist" in m or "does not exist" in m:
        return "ID não encontrado: confira META_PAGE_ID e se o usuário do sistema tem acesso à página."
    if "leads access" in m or "lead access" in m:
        return "Libere o app em Configurações do negócio → Integrações → Acesso a leads."
    return ""


def configurado() -> bool:
    return bool(settings.META_ACCESS_TOKEN and settings.META_PAGE_ID)


def situacao_variaveis() -> dict:
    """Quais variáveis estão definidas (nunca os valores)."""
    return {
        "META_ACCESS_TOKEN": bool(settings.META_ACCESS_TOKEN),
        "META_PAGE_ID": bool(settings.META_PAGE_ID),
        "META_APP_SECRET": bool(settings.META_APP_SECRET),
        "META_VERIFY_TOKEN": bool(settings.META_VERIFY_TOKEN),
    }


def assinatura_valida(corpo: bytes, cabecalho: str | None) -> bool:
    """Confere o X-Hub-Signature-256 enviado pela Meta (HMAC-SHA256 do corpo com a chave secreta do app)."""
    if not settings.META_APP_SECRET or not cabecalho or not cabecalho.startswith("sha256="):
        return False
    esperado = hmac.new(settings.META_APP_SECRET.encode(), corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, cabecalho.removeprefix("sha256="))


# ── Cliente da Graph API ──────────────────────────────────────────────────────

class MetaCliente:
    def __init__(self):
        self._token_sistema = settings.META_ACCESS_TOKEN
        self._token_pagina: str | None = None
        self.nome_pagina: str | None = None
        self._formularios: dict[str, str] = {}
        self._http = httpx.AsyncClient(
            base_url=f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}",
            timeout=httpx.Timeout(20.0),
            transport=_transporte,
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self._http.aclose()

    def _params(self, token: str, params: dict | None) -> dict:
        p = dict(params or {})
        if settings.META_APP_SECRET:  # exigido quando o app tem "Exigir chave secreta" ligado
            p["appsecret_proof"] = hmac.new(settings.META_APP_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()
        return p

    async def _req(self, metodo: str, caminho: str, params: dict | None = None, pagina: bool = True) -> dict:
        token = (self._token_pagina or self._token_sistema) if pagina else self._token_sistema
        try:
            r = await self._http.request(metodo, caminho, params=self._params(token, params),
                                         headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as e:
            raise MetaErro(f"Sem conexão com a Meta ({type(e).__name__})") from None
        try:
            dados = r.json()
        except ValueError:
            raise MetaErro(f"Resposta inválida da Meta (HTTP {r.status_code})") from None
        if isinstance(dados, dict) and "error" in dados:
            e = dados["error"]
            dica = _dica(e.get("code"), e.get("message", ""))
            raise MetaErro(f"{e.get('message', 'Erro da Meta')} (código {e.get('code')})" + (f" — {dica}" if dica else ""))
        if r.status_code >= 400:
            raise MetaErro(f"Erro da Meta (HTTP {r.status_code})")
        return dados

    async def _paginar(self, caminho: str, params: dict, limite_paginas: int = 50, pagina: bool = True) -> list[dict]:
        itens: list[dict] = []
        params = {**params, "limit": 100}
        for _ in range(limite_paginas):
            dados = await self._req("GET", caminho, params, pagina=pagina)
            itens.extend(dados.get("data", []))
            depois = (dados.get("paging") or {}).get("cursors", {}).get("after")
            if not depois or not (dados.get("paging") or {}).get("next"):
                break
            params["after"] = depois
        return itens

    async def conectar_pagina(self) -> dict:
        """Confere a página e obtém o token dela.

        Ordem: lista de páginas do usuário do sistema (/me/accounts) → campo access_token da página →
        o próprio token informado (que pode já ser um token de página). O campo access_token não existe
        em todos os casos (ex.: quando o token já é de página), por isso não é obrigatório.
        """
        dados = await self._req("GET", f"/{settings.META_PAGE_ID}", {"fields": "id,name"}, pagina=False)
        self.nome_pagina = dados.get("name")
        self._token_pagina = None
        try:
            contas = await self._paginar("/me/accounts", {"fields": "id,access_token"}, limite_paginas=20, pagina=False)
            self._token_pagina = next(
                (c.get("access_token") for c in contas if str(c.get("id")) == str(settings.META_PAGE_ID)), None
            )
        except MetaErro:
            pass
        if not self._token_pagina:
            try:
                extra = await self._req("GET", f"/{settings.META_PAGE_ID}", {"fields": "access_token"}, pagina=False)
                self._token_pagina = extra.get("access_token")
            except MetaErro:
                pass
        self._token_pagina = self._token_pagina or self._token_sistema
        self.tipo_token = "página" if self._token_pagina != self._token_sistema else "informado"
        return {"id": dados.get("id"), "nome": self.nome_pagina, "token_usado": self.tipo_token}

    async def diagnostico(self) -> dict:
        """Ajuda a achar o META_PAGE_ID certo: tipo do ID informado, dono do token e páginas acessíveis.

        Cada consulta é independente (falhas são ignoradas); nenhum token é devolvido.
        """
        def resumo(d: dict) -> dict:
            return {"id": d.get("id"), "nome": d.get("name"), "tipo": (d.get("metadata") or {}).get("type")}

        out: dict = {"id_informado": None, "dono_do_token": None, "paginas": None}
        try:
            out["id_informado"] = resumo(await self._req(
                "GET", f"/{settings.META_PAGE_ID}", {"fields": "id,name", "metadata": "1"}, pagina=False))
        except MetaErro as e:
            out["id_informado"] = {"id": settings.META_PAGE_ID, "erro": str(e)}
        try:
            out["dono_do_token"] = resumo(await self._req("GET", "/me", {"fields": "id,name", "metadata": "1"}, pagina=False))
        except MetaErro:
            pass
        try:
            contas = await self._paginar("/me/accounts", {"fields": "id,name"}, limite_paginas=20, pagina=False)
            out["paginas"] = [{"id": c.get("id"), "nome": c.get("name")} for c in contas]
        except MetaErro:
            pass
        return out

    async def formularios(self) -> list[dict]:
        forms = await self._paginar(f"/{settings.META_PAGE_ID}/leadgen_forms", {"fields": "id,name,status"})
        self._formularios.update({f["id"]: f.get("name") for f in forms})
        return forms

    async def nome_formulario(self, form_id: str | None) -> str | None:
        if not form_id:
            return None
        if form_id not in self._formularios:
            try:
                self._formularios[form_id] = (await self._req("GET", f"/{form_id}", {"fields": "name"})).get("name")
            except MetaErro:
                self._formularios[form_id] = None
        return self._formularios[form_id]

    async def leads_do_formulario(self, form_id: str, desde: datetime) -> list[dict]:
        filtro = [{"field": "time_created", "operator": "GREATER_THAN", "value": int(desde.timestamp())}]
        return await self._paginar(f"/{form_id}/leads", {"fields": CAMPOS_LEAD, "filtering": json.dumps(filtro)})

    async def lead(self, leadgen_id: str) -> dict:
        return await self._req("GET", f"/{leadgen_id}", {"fields": CAMPOS_LEAD})

    async def assinaturas(self) -> list[dict]:
        return (await self._req("GET", f"/{settings.META_PAGE_ID}/subscribed_apps")).get("data", [])

    async def assinar_leadgen(self) -> bool:
        dados = await self._req("POST", f"/{settings.META_PAGE_ID}/subscribed_apps", {"subscribed_fields": "leadgen"})
        return bool(dados.get("success"))


# ── Conversão Graph API → formato de crm.criar_lead ──────────────────────────

def converter_lead(lead: dict, nome_formulario: str | None) -> dict:
    """Mapeia o lead da Graph API para o mesmo dicionário produzido pela leitura do CSV."""
    campos: dict[str, str] = {}
    rotulos: dict[str, str] = {}
    for f in lead.get("field_data", []):
        valores = [v for v in (f.get("values") or []) if v]
        if valores:
            campos[svc._norm(f.get("name", ""))] = ", ".join(valores)
            rotulos[svc._norm(f.get("name", ""))] = f.get("name", "")

    def primeiro(nomes: list[str]) -> str:
        return next((campos[n] for n in nomes if campos.get(n)), "")

    nome = primeiro(svc.ALIASES["nome"])
    if not nome:
        nome = " ".join(x for x in (campos.get("firstname"), campos.get("lastname")) if x)
    telefone = primeiro(svc.TELEFONE_COLUNAS)
    email = primeiro(svc.ALIASES["email"])

    usados = set(svc.ALIASES["nome"]) | set(svc.TELEFONE_COLUNAS) | set(svc.ALIASES["email"]) | {"firstname", "lastname"}
    extras = {rotulos[k]: v for k, v in campos.items() if k not in usados}
    if lead.get("is_organic"):
        extras["Origem"] = "Orgânico"

    campanha = lead.get("campaign_name")
    if not campanha and nome_formulario:  # lead orgânico: sem campanha, usa o formulário
        campanha = re.sub(r"\s*\(v\d+\)\s*$", "", nome_formulario, flags=re.I)

    return {
        "meta_lead_id": str(lead["id"]),
        "nome": nome or "Sem nome",
        "telefone": telefone.removeprefix("p:"),
        "email": email,
        "campanha": campanha,
        "meta_campaign_id": lead.get("campaign_id"),
        "conjunto_anuncio": lead.get("adset_name"),
        "anuncio": lead.get("ad_name"),
        "formulario": nome_formulario,
        "plataforma": lead.get("platform"),
        "recebido_em": svc._parse_data(lead.get("created_time", "")),
        "dados_extras": extras,
    }


# ── Registro de estado (crm_config) ──────────────────────────────────────────

async def _registrar(db: AsyncSession, chave: str, valor) -> None:
    await svc.set_config(db, chave, valor if isinstance(valor, str) or valor is None else json.dumps(valor, ensure_ascii=False))


async def registrar_erro(db: AsyncSession, mensagem: str) -> None:
    await _registrar(db, "meta_ultimo_erro", {"em": svc.agora().isoformat(), "mensagem": mensagem})


async def estado(db: AsyncSession) -> dict:
    async def ler(chave):
        v = await svc.get_config(db, chave)
        try:
            return json.loads(v) if v and v[:1] in "{[" else v
        except ValueError:
            return v
    return {
        "ultima_sincronizacao": await ler("meta_ultima_sync"),
        "ultimo_resultado": await ler("meta_ultimo_resultado"),
        "ultimo_erro": await ler("meta_ultimo_erro"),
        "ultimo_webhook": await ler("meta_ultimo_webhook"),
    }


# ── Sincronização e webhook ──────────────────────────────────────────────────

async def sincronizar(db: AsyncSession, dias: int | None = None) -> dict:
    """Busca leads recentes de todos os formulários da página e importa os que faltam."""
    if not configurado():
        raise MetaErro("Integração não configurada: defina META_ACCESS_TOKEN e META_PAGE_ID")
    if dias:
        desde = svc.agora() - timedelta(days=dias)
    else:
        ultima = await svc.get_config(db, "meta_ultima_sync")
        desde = (
            datetime.fromisoformat(ultima) - timedelta(hours=HORAS_SOBREPOSICAO)
            if ultima else svc.agora() - timedelta(days=DIAS_PRIMEIRA_SYNC)
        )
    inicio = svc.agora()

    async with MetaCliente() as cli:
        await cli.conectar_pagina()
        forms = await cli.formularios()
        linhas = []
        for f in forms:
            for lead in await cli.leads_do_formulario(f["id"], desde):
                linhas.append(converter_lead(lead, f.get("name")))

    res = await svc.importar_lote(db, linhas, "meta", None)
    resultado = {
        "em": inicio.isoformat(), "desde": desde.isoformat(), "formularios": len(forms),
        "recebidos": len(linhas), "inseridos": res["inseridos"], "duplicados": res["duplicados"],
    }
    await _registrar(db, "meta_ultima_sync", inicio.isoformat())
    await _registrar(db, "meta_ultimo_resultado", resultado)
    return resultado


async def processar_webhook(db: AsyncSession, payload: dict) -> dict:
    """Trata o aviso `leadgen` da Meta: busca cada lead citado e importa."""
    ids = [
        (str(ch["value"]["leadgen_id"]), ch["value"].get("form_id"))
        for entrada in payload.get("entry", [])
        for ch in entrada.get("changes", [])
        if ch.get("field") == "leadgen" and ch.get("value", {}).get("leadgen_id")
    ]
    await _registrar(db, "meta_ultimo_webhook", svc.agora().isoformat())
    if not ids:
        return {"recebidos": 0, "inseridos": 0, "duplicados": 0}

    async with MetaCliente() as cli:
        await cli.conectar_pagina()
        linhas = []
        for leadgen_id, form_id in ids:
            lead = await cli.lead(leadgen_id)
            linhas.append(converter_lead(lead, await cli.nome_formulario(form_id or lead.get("form_id"))))

    res = await svc.importar_lote(db, linhas, "meta", None)
    return {"recebidos": len(ids), "inseridos": res["inseridos"], "duplicados": res["duplicados"]}
