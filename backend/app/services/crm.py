"""
Regras de negócio do CRM de Leads.

- Constantes de status, temperatura e motivos de perda (fonte única para API e frontend)
- Distribuição de leads: vendedor padrão da campanha → rodízio entre vendedores ativos
- Leitura do CSV exportado do Gerenciador de Anúncios / Central de Leads da Meta
- Cálculo dos alertas (novo sem atendimento, retorno hoje/atrasado)
"""
import csv
import io
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.crm import CrmCampanha, CrmConfig, CrmHistorico, CrmLead
from app.models.usuario import Usuario

# ── Constantes ────────────────────────────────────────────────────────────────

STATUS = [
    ("novo", "Novo lead"),
    ("tentativa_contato", "Tentativa de contato"),
    ("em_atendimento", "Em atendimento"),
    ("aguardando_retorno", "Aguardando retorno do lead"),
    ("aguardando_decisao", "Aguardando decisão"),
    ("matriculado", "Matriculado"),
    ("perdido", "Perdido"),
    ("sem_retorno", "Sem retorno após tentativas"),
]
STATUS_LABEL = dict(STATUS)
STATUS_FINAIS = {"matriculado", "perdido", "sem_retorno"}

TEMPERATURAS = [("quente", "Quente"), ("morno", "Morno"), ("frio", "Frio")]
TEMPERATURA_LABEL = dict(TEMPERATURAS)

MOTIVOS_PERDA = [
    ("preco", "Preço / condição de pagamento"),
    ("horario", "Horário ou turno incompatível"),
    ("localizacao", "Localização / deslocamento"),
    ("concorrente", "Matriculou-se em outra instituição"),
    ("sem_interesse", "Perdeu o interesse"),
    ("pre_requisito", "Não atende aos pré-requisitos"),
    ("adiou", "Adiou para outra turma"),
    ("contato_invalido", "Contato inválido"),
    ("outro", "Outro"),
]
MOTIVO_LABEL = dict(MOTIVOS_PERDA)

PERFIS_CRM = {"admin", "vendedor"}

CONFIG_PADRAO = {
    "horas_alerta_novo": "2",
}

FUSO_BR = timezone(timedelta(hours=-3))


# ── Helpers ───────────────────────────────────────────────────────────────────

def agora() -> datetime:
    return datetime.now(timezone.utc)


def hoje_br() -> date:
    return datetime.now(FUSO_BR).date()


def como_utc(dt: datetime | None) -> datetime | None:
    """SQLite devolve datetimes sem fuso; trata-os como UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def normalizar_telefone(tel: str | None) -> str | None:
    """'p:+55 (62) 99999-0000' → '5562999990000'. Mantém só dígitos."""
    if not tel:
        return None
    digitos = re.sub(r"\D", "", tel)
    return digitos or None


async def get_config(db: AsyncSession, chave: str) -> str | None:
    row = await db.get(CrmConfig, chave)
    if row is not None:
        return row.valor
    return CONFIG_PADRAO.get(chave)


async def set_config(db: AsyncSession, chave: str, valor: str | None) -> None:
    row = await db.get(CrmConfig, chave)
    if row is None:
        db.add(CrmConfig(chave=chave, valor=valor))
    else:
        row.valor = valor


async def horas_alerta_novo(db: AsyncSession) -> float:
    try:
        return float(await get_config(db, "horas_alerta_novo") or 2)
    except ValueError:
        return 2.0


def calcular_alertas(lead: CrmLead, horas_alerta: float, ref: datetime | None = None) -> list[str]:
    """Alertas visuais da lista: novo_sem_atendimento | retorno_hoje | retorno_atrasado | sem_vendedor."""
    ref = ref or agora()
    alertas: list[str] = []
    if lead.status == "novo":
        recebido = como_utc(lead.recebido_em)
        if recebido and ref - recebido > timedelta(hours=horas_alerta):
            alertas.append("novo_sem_atendimento")
    if lead.status not in STATUS_FINAIS and lead.proximo_retorno:
        hoje = hoje_br()
        if lead.proximo_retorno < hoje:
            alertas.append("retorno_atrasado")
        elif lead.proximo_retorno == hoje:
            alertas.append("retorno_hoje")
    if lead.vendedor_id is None and lead.status not in STATUS_FINAIS:
        alertas.append("sem_vendedor")
    return alertas


def registrar(db: AsyncSession, lead: CrmLead, usuario: Usuario | None, campo: str,
              anterior=None, novo=None) -> None:
    db.add(CrmHistorico(
        lead_id=lead.id,
        usuario_id=usuario.id if usuario else None,
        usuario_nome=usuario.nome if usuario else "Sistema",
        campo=campo,
        valor_anterior=None if anterior is None else str(anterior),
        valor_novo=None if novo is None else str(novo),
        criado_em=agora(),
    ))


# ── Distribuição de leads ─────────────────────────────────────────────────────

async def vendedores_ativos(db: AsyncSession) -> list[Usuario]:
    res = await db.execute(
        select(Usuario).where(Usuario.perfil == "vendedor", Usuario.ativo == True).order_by(Usuario.id)  # noqa: E712
    )
    return list(res.scalars().all())


async def escolher_vendedor(db: AsyncSession, campanha: CrmCampanha | None,
                            ativos: list[Usuario] | None = None) -> int | None:
    """Vendedor padrão da campanha (se ativo); senão o próximo do rodízio."""
    ativos = ativos if ativos is not None else await vendedores_ativos(db)
    ids = [u.id for u in ativos]
    if campanha and campanha.vendedor_padrao_id in ids:
        return campanha.vendedor_padrao_id
    if not ids:
        return None
    ultimo = await get_config(db, "rodizio_ultimo_id")
    ultimo_id = int(ultimo) if ultimo and ultimo.isdigit() else 0
    proximo = next((i for i in ids if i > ultimo_id), ids[0])
    await set_config(db, "rodizio_ultimo_id", str(proximo))
    return proximo


async def obter_campanha(db: AsyncSession, nome: str | None, meta_campaign_id: str | None = None,
                         cache: dict | None = None) -> CrmCampanha | None:
    """Busca a campanha pelo id da Meta ou pelo nome; cria se não existir."""
    nome = (nome or "").strip()
    if not nome and not meta_campaign_id:
        return None
    chave = meta_campaign_id or nome.lower()
    if cache is not None and chave in cache:
        return cache[chave]
    camp = None
    if meta_campaign_id:
        camp = (await db.execute(
            select(CrmCampanha).where(CrmCampanha.meta_campaign_id == meta_campaign_id)
        )).scalar_one_or_none()
    if camp is None and nome:
        camp = (await db.execute(select(CrmCampanha).where(CrmCampanha.nome == nome))).scalar_one_or_none()
    if camp is None:
        camp = CrmCampanha(nome=nome or f"Campanha {meta_campaign_id}", meta_campaign_id=meta_campaign_id)
        db.add(camp)
        await db.flush()
    elif meta_campaign_id and not camp.meta_campaign_id:
        camp.meta_campaign_id = meta_campaign_id
    if cache is not None:
        cache[chave] = camp
    return camp


async def criar_lead(db: AsyncSession, dados: dict, origem: str, usuario: Usuario | None,
                     cache_campanhas: dict | None = None, ativos: list[Usuario] | None = None) -> CrmLead:
    """Cria o lead, aplica oferta/vendedor da campanha e registra no histórico."""
    campanha = await obter_campanha(db, dados.get("campanha"), dados.get("meta_campaign_id"), cache_campanhas)
    vendedor_id = dados.get("vendedor_id")
    if vendedor_id is None:
        vendedor_id = await escolher_vendedor(db, campanha, ativos)
    lead = CrmLead(
        meta_lead_id=dados.get("meta_lead_id"),
        nome=(dados.get("nome") or "Sem nome").strip()[:300],
        telefone=normalizar_telefone(dados.get("telefone")),
        email=(dados.get("email") or "").strip().lower() or None,
        campanha_id=campanha.id if campanha else None,
        conjunto_anuncio=dados.get("conjunto_anuncio"),
        anuncio=dados.get("anuncio"),
        formulario=dados.get("formulario"),
        plataforma=dados.get("plataforma"),
        origem=origem,
        recebido_em=(dados.get("recebido_em") or agora()).astimezone(timezone.utc),
        dados_extras=dados.get("dados_extras") or None,
        temperatura=dados.get("temperatura"),
        status="novo",
        vendedor_id=vendedor_id,
        oferta_id=dados.get("oferta_id") or (campanha.oferta_id if campanha else None),
        observacoes=dados.get("observacoes"),
    )
    db.add(lead)
    await db.flush()
    registrar(db, lead, usuario, "criacao", None, f"Lead recebido via {origem}")
    return lead


# ── Importação do CSV da Meta ─────────────────────────────────────────────────

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s.lower())


# Cabeçalhos aceitos (export da Meta em inglês/português e planilhas próprias)
ALIASES = {
    "meta_lead_id": ["id", "leadid", "idlead"],
    "recebido_em": ["createdtime", "datadecriacao", "data", "datahora", "datarecebimento", "criadoem"],
    "nome": ["fullname", "nomecompleto", "nome", "name"],
    "telefone": ["phonenumber", "telefone", "phone", "celular", "whatsapp", "numerodetelefone"],
    "email": ["email", "emailaddress"],
    "campanha": ["campaignname", "campanha", "nomedacampanha"],
    "meta_campaign_id": ["campaignid", "iddacampanha"],
    "conjunto_anuncio": ["adsetname", "conjuntodeanuncios", "nomedoconjuntodeanuncios"],
    "anuncio": ["adname", "anuncio", "nomedoanuncio"],
    "formulario": ["formname", "formulario", "nomedoformulario"],
    "plataforma": ["platform", "plataforma"],
}
IGNORAR_EXTRAS = {"adid", "adsetid", "formid", "isorganic", "leadstatus", "inboxurl"}


def _decodificar(conteudo: bytes) -> str:
    if conteudo[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return conteudo.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return conteudo.decode(enc)
        except UnicodeDecodeError:
            continue
    return conteudo.decode("latin-1")


def _parse_data(valor: str) -> datetime | None:
    v = (valor or "").strip()
    if not v:
        return None
    try:  # ISO da Meta: 2026-10-15T14:32:10-03:00 / +0000
        dt = datetime.fromisoformat(re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", v.replace("Z", "+00:00")))
        return dt if dt.tzinfo else dt.replace(tzinfo=FUSO_BR)
    except ValueError:
        pass
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=FUSO_BR)
        except ValueError:
            continue
    return None


def ler_csv_meta(conteudo: bytes) -> tuple[list[dict], list[str]]:
    """Converte o CSV em dicionários no formato de `criar_lead`. Retorna (linhas, erros)."""
    texto = _decodificar(conteudo)
    amostra = texto[:5000]
    try:
        dialeto = csv.Sniffer().sniff(amostra, delimiters=",;\t")
    except csv.Error:
        dialeto = csv.excel_tab if amostra.count("\t") > amostra.count(",") else csv.excel
    leitor = csv.reader(io.StringIO(texto), dialeto)
    linhas = [r for r in leitor if any(c.strip() for c in r)]
    if not linhas:
        return [], ["Arquivo vazio."]

    cabecalho = [_norm(h) for h in linhas[0]]
    mapa: dict[str, int] = {}
    for campo, nomes in ALIASES.items():
        for i, h in enumerate(cabecalho):
            if h in nomes:
                mapa[campo] = i
                break
    if "nome" not in mapa or ("telefone" not in mapa and "email" not in mapa):
        return [], ["Cabeçalho não reconhecido: o arquivo precisa ter colunas de nome e telefone ou e-mail."]
    usados = set(mapa.values())

    resultado, erros = [], []
    for n, row in enumerate(linhas[1:], start=2):
        row = row + [""] * (len(cabecalho) - len(row))

        def val(campo):
            i = mapa.get(campo)
            return row[i].strip() if i is not None else ""

        nome = val("nome")
        if not nome:
            erros.append(f"Linha {n}: sem nome")
            continue
        recebido = _parse_data(val("recebido_em"))
        lead_id = val("meta_lead_id").removeprefix("l:") or None
        telefone = val("telefone").removeprefix("p:")
        extras = {
            linhas[0][i].strip(): row[i].strip()
            for i, h in enumerate(cabecalho)
            if i not in usados and h not in IGNORAR_EXTRAS and i < len(row) and row[i].strip()
        }
        resultado.append({
            "meta_lead_id": lead_id,
            "nome": nome,
            "telefone": telefone,
            "email": val("email"),
            "campanha": val("campanha") or None,
            "meta_campaign_id": val("meta_campaign_id").removeprefix("c:") or None,
            "conjunto_anuncio": val("conjunto_anuncio") or None,
            "anuncio": val("anuncio") or None,
            "formulario": val("formulario") or None,
            "plataforma": val("plataforma") or None,
            "recebido_em": recebido,
            "dados_extras": extras,
        })
    return resultado, erros
