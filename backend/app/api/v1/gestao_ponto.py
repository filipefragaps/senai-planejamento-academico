"""
Gestão de Ponto — API de persistência.
O parsing do TXT acontece no frontend (TypeScript); esta API recebe os dados
já parseados e os armazena incrementalmente no banco.

Regra de importação incremental:
- GpColaborador  → upsert por matrícula (sempre atualiza)
- GpRegistroDiario → upsert por (matricula, date_key) (sempre atualiza batidas/minutos)
- GpOcorrencia   → upsert por occurrence_id; status NUNCA é sobrescrito se != "pending"
- GpBancoHoras   → upsert por matrícula (sempre atualiza saldo)
"""

import json
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.gestao_ponto import (
    GpColaborador, GpRegistroDiario, GpOcorrencia, GpBancoHoras, GpBalanceMensal, GpImportacao, GpPainel,
)
from app.core.deps import get_current_user, require_admin, require_admin_ou_rh

router = APIRouter(prefix="/gestao-ponto", tags=["Gestão de Ponto"])


# ─── Schemas de entrada ───────────────────────────────────────────────────────

class ContactIn(BaseModel):
    matricula: str
    nome: str
    email: str = ""
    supervisor: str = ""
    supervisorEmail: str = ""
    area: str = ""
    weeklyHours: str | None = None
    schedule: str | None = None

class DailyRecordIn(BaseModel):
    matricula: str
    collaborator: str
    date: str          # DD/MM/YYYY
    dateKey: str       # YYYYMMDD
    area: str = ""
    supervisor: str = ""
    supervisorEmail: str = ""
    weeklyHours: str | None = None
    schedule: str | None = None
    scheduleCode: str | None = None
    expectedMinutes: int = 0
    workedMinutes: int = 0
    punches: list[str] = []
    nonWorkingReason: str | None = None

class OccurrenceIn(BaseModel):
    id: str            # occurrence_id vindo do parser
    matricula: str
    collaborator: str
    date: str          # DD/MM/YYYY
    dateKey: str       # YYYYMMDD (calculado no frontend)
    category: str
    severity: str = ""
    detail: str = ""
    punches: list[str] = []
    schedule: str = ""
    scaleSuggestion: dict | None = None
    status: str = "pending"
    email: str = ""
    supervisor: str = ""
    supervisorEmail: str = ""
    area: str = ""

class BalanceIn(BaseModel):
    matricula: str
    collaborator: str
    minutes: int
    label: str = ""
    critical: bool = False
    area: str = ""
    supervisor: str = ""
    supervisorEmail: str = ""
    sourceMonth: str = ""
    sourceFile: str = ""

class MonthlyBalanceIn(BaseModel):
    matricula: str
    collaborator: str
    month: str          # YYYY-MM
    monthLabel: str = ""
    initialMinutes: int = 0
    creditMinutes: int = 0
    debitMinutes: int = 0
    accumulatedMinutes: int = 0
    accumulatedLabel: str = ""
    critical: bool = False
    fileName: str = ""

class BaseImportPayload(BaseModel):
    contacts: list[ContactIn]
    unidade: str = ""
    fileName: str = ""

class PontoImportPayload(BaseModel):
    fileName: str
    unidade: str = ""
    period: str = ""
    people: int = 0
    dailyRecords: list[DailyRecordIn]
    occurrences: list[OccurrenceIn]
    balances: list[BalanceIn]
    monthlyBalances: list[MonthlyBalanceIn] = []


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/base", status_code=200)
async def importar_base(
    payload: BaseImportPayload,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_rh),
):
    """Salva/atualiza a base de colaboradores importada do Excel."""
    for c in payload.contacts:
        existing = await db.get(GpColaborador, c.matricula)
        if existing:
            existing.nome = c.nome
            existing.email = c.email
            existing.supervisor = c.supervisor
            existing.supervisor_email = c.supervisorEmail
            existing.area = c.area
            existing.weekly_hours = c.weeklyHours
            existing.schedule = c.schedule
            existing.unidade = payload.unidade
        else:
            db.add(GpColaborador(
                matricula=c.matricula, nome=c.nome, email=c.email,
                supervisor=c.supervisor, supervisor_email=c.supervisorEmail,
                area=c.area, weekly_hours=c.weeklyHours, schedule=c.schedule,
                unidade=payload.unidade,
            ))
    await db.commit()
    return {"importados": len(payload.contacts), "unidade": payload.unidade}


@router.post("/importar", status_code=200)
async def importar_ponto(
    payload: PontoImportPayload,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_rh),
):
    """
    Recebe dados já parseados do TXT e salva incrementalmente.
    Registros existentes são atualizados; status de ocorrências já tratadas é preservado.
    """
    diarios_inseridos = diarios_atualizados = 0
    occ_inseridas = occ_atualizadas = status_mantido = 0
    banco_atualizados = 0
    mensais_atualizados = 0

    # ── Registros diários ────────────────────────────────────────────────────
    for rec in payload.dailyRecords:
        stmt = select(GpRegistroDiario).where(
            GpRegistroDiario.matricula == rec.matricula,
            GpRegistroDiario.date_key == rec.dateKey,
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            existing.worked_minutes = rec.workedMinutes
            existing.expected_minutes = rec.expectedMinutes
            existing.punches = json.dumps(rec.punches)
            existing.schedule = rec.schedule
            existing.schedule_code = rec.scheduleCode
            existing.weekly_hours = rec.weeklyHours
            existing.non_working_reason = rec.nonWorkingReason
            diarios_atualizados += 1
        else:
            db.add(GpRegistroDiario(
                matricula=rec.matricula, collaborator=rec.collaborator,
                date_key=rec.dateKey, date_display=rec.date,
                area=rec.area, supervisor=rec.supervisor,
                supervisor_email=rec.supervisorEmail,
                weekly_hours=rec.weeklyHours, schedule=rec.schedule,
                schedule_code=rec.scheduleCode,
                expected_minutes=rec.expectedMinutes, worked_minutes=rec.workedMinutes,
                punches=json.dumps(rec.punches),
                non_working_reason=rec.nonWorkingReason,
            ))
            diarios_inseridos += 1

    # ── Ocorrências ──────────────────────────────────────────────────────────
    for occ in payload.occurrences:
        existing = await db.get(GpOcorrencia, occ.id)
        if existing:
            existing.detail = occ.detail
            existing.punches = json.dumps(occ.punches)
            existing.schedule = occ.schedule
            existing.scale_suggestion = json.dumps(occ.scaleSuggestion) if occ.scaleSuggestion else None
            existing.email = occ.email
            existing.supervisor = occ.supervisor
            existing.supervisor_email = occ.supervisorEmail
            existing.severity = occ.severity
            # Preserva status se o usuário já tratou
            if existing.status == "pending":
                existing.status = occ.status
            else:
                status_mantido += 1
            occ_atualizadas += 1
        else:
            db.add(GpOcorrencia(
                occurrence_id=occ.id, matricula=occ.matricula,
                collaborator=occ.collaborator, date_display=occ.date,
                date_key=occ.dateKey, category=occ.category,
                severity=occ.severity, detail=occ.detail,
                punches=json.dumps(occ.punches), schedule=occ.schedule,
                scale_suggestion=json.dumps(occ.scaleSuggestion) if occ.scaleSuggestion else None,
                status=occ.status, email=occ.email,
                supervisor=occ.supervisor, supervisor_email=occ.supervisorEmail,
                area=occ.area,
            ))
            occ_inseridas += 1

    # ── Banco de horas ───────────────────────────────────────────────────────
    for bal in payload.balances:
        existing = await db.get(GpBancoHoras, bal.matricula)
        if existing:
            existing.minutes = bal.minutes
            existing.label = bal.label
            existing.critical = bal.critical
            existing.collaborator = bal.collaborator
            existing.area = bal.area
            existing.supervisor = bal.supervisor
            existing.supervisor_email = bal.supervisorEmail
        else:
            db.add(GpBancoHoras(
                matricula=bal.matricula, collaborator=bal.collaborator,
                minutes=bal.minutes, label=bal.label, critical=bal.critical,
                area=bal.area, supervisor=bal.supervisor,
                supervisor_email=bal.supervisorEmail,
            ))
        banco_atualizados += 1

    # ── Saldos mensais oficiais FPW ──────────────────────────────────────────
    for mb in payload.monthlyBalances:
        stmt = select(GpBalanceMensal).where(
            GpBalanceMensal.matricula == mb.matricula,
            GpBalanceMensal.month == mb.month,
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            existing.initial_minutes = mb.initialMinutes
            existing.credit_minutes = mb.creditMinutes
            existing.debit_minutes = mb.debitMinutes
            existing.accumulated_minutes = mb.accumulatedMinutes
            existing.accumulated_label = mb.accumulatedLabel
            existing.critical = mb.critical
            existing.file_name = mb.fileName
            existing.collaborator = mb.collaborator
            existing.month_label = mb.monthLabel
        else:
            db.add(GpBalanceMensal(
                matricula=mb.matricula, collaborator=mb.collaborator,
                month=mb.month, month_label=mb.monthLabel,
                initial_minutes=mb.initialMinutes, credit_minutes=mb.creditMinutes,
                debit_minutes=mb.debitMinutes, accumulated_minutes=mb.accumulatedMinutes,
                accumulated_label=mb.accumulatedLabel, critical=mb.critical,
                file_name=mb.fileName,
            ))
        mensais_atualizados += 1

    # ── Log da importação ────────────────────────────────────────────────────
    db.add(GpImportacao(
        file_name=payload.fileName, unidade=payload.unidade,
        period=payload.period, people=payload.people,
        daily_records=diarios_inseridos + diarios_atualizados,
        occurrences_total=occ_inseridas + occ_atualizadas,
    ))

    await db.commit()
    return {
        "diarios": {"inseridos": diarios_inseridos, "atualizados": diarios_atualizados},
        "ocorrencias": {"inseridas": occ_inseridas, "atualizadas": occ_atualizadas, "statusMantido": status_mantido},
        "banco": {"atualizados": banco_atualizados},
        "saldosMensais": {"atualizados": mensais_atualizados},
    }


@router.get("/dados")
async def get_dados(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_rh),
):
    """Retorna todos os dados armazenados para a página de Gestão de Ponto."""
    contacts_rows = (await db.execute(select(GpColaborador).order_by(GpColaborador.nome))).scalars().all()
    daily_rows = (await db.execute(select(GpRegistroDiario).order_by(GpRegistroDiario.date_key))).scalars().all()
    occ_rows = (await db.execute(select(GpOcorrencia).order_by(GpOcorrencia.date_key))).scalars().all()
    bank_rows = (await db.execute(select(GpBancoHoras).order_by(GpBancoHoras.collaborator))).scalars().all()
    monthly_rows = (await db.execute(
        select(GpBalanceMensal).order_by(GpBalanceMensal.month, GpBalanceMensal.collaborator)
    )).scalars().all()
    last_import = (await db.execute(
        select(GpImportacao).order_by(GpImportacao.imported_at.desc()).limit(1)
    )).scalar_one_or_none()

    unidade = contacts_rows[0].unidade if contacts_rows else ""

    return {
        "contacts": [
            {
                "matricula": c.matricula, "nome": c.nome, "email": c.email,
                "supervisor": c.supervisor, "supervisorEmail": c.supervisor_email,
                "area": c.area, "weeklyHours": c.weekly_hours, "schedule": c.schedule,
            }
            for c in contacts_rows
        ],
        "unidade": unidade,
        "dailyRecords": [
            {
                "matricula": d.matricula, "collaborator": d.collaborator,
                "date": d.date_display, "dateKey": d.date_key,
                "area": d.area, "supervisor": d.supervisor,
                "supervisorEmail": d.supervisor_email,
                "weeklyHours": d.weekly_hours, "schedule": d.schedule,
                "scheduleCode": d.schedule_code,
                "expectedMinutes": d.expected_minutes, "workedMinutes": d.worked_minutes,
                "punches": json.loads(d.punches or "[]"),
                "nonWorkingReason": d.non_working_reason,
            }
            for d in daily_rows
        ],
        "occurrences": [
            {
                "id": o.occurrence_id, "matricula": o.matricula,
                "collaborator": o.collaborator, "date": o.date_display,
                "dateKey": o.date_key, "category": o.category,
                "severity": o.severity, "detail": o.detail,
                "punches": json.loads(o.punches or "[]"),
                "schedule": o.schedule,
                "scaleSuggestion": json.loads(o.scale_suggestion) if o.scale_suggestion else None,
                "status": o.status, "email": o.email,
                "supervisor": o.supervisor, "supervisorEmail": o.supervisor_email,
                "area": o.area,
            }
            for o in occ_rows
        ],
        "balances": [
            {
                "matricula": b.matricula, "collaborator": b.collaborator,
                "minutes": b.minutes, "label": b.label, "critical": b.critical,
                "area": b.area, "supervisor": b.supervisor,
                "supervisorEmail": b.supervisor_email,
            }
            for b in bank_rows
        ],
        "monthlyBalances": [
            {
                "matricula": m.matricula, "collaborator": m.collaborator,
                "month": m.month, "monthLabel": m.month_label,
                "initialMinutes": m.initial_minutes, "creditMinutes": m.credit_minutes,
                "debitMinutes": m.debit_minutes, "accumulatedMinutes": m.accumulated_minutes,
                "accumulatedLabel": m.accumulated_label, "critical": m.critical,
                "fileName": m.file_name,
                "email": "", "area": m.area, "supervisor": m.supervisor,
                "supervisorEmail": m.supervisor_email,
                "director": "", "directorEmail": "", "unidade": "",
            }
            for m in monthly_rows
        ],
        "lastImport": {
            "fileName": last_import.file_name,
            "unidade": last_import.unidade,
            "period": last_import.period,
            "people": last_import.people,
            "importedAt": last_import.imported_at.isoformat(),
        } if last_import else None,
    }


@router.patch("/ocorrencias/{occurrence_id}/status", status_code=200)
async def update_status(
    occurrence_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_rh),
):
    """Atualiza o status de uma ocorrência (pending → approved / ignored)."""
    novo_status = body.get("status")
    if novo_status not in ("pending", "approved", "ignored"):
        raise HTTPException(status_code=400, detail="Status inválido")
    occ = await db.get(GpOcorrencia, occurrence_id)
    if not occ:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    occ.status = novo_status
    await db.commit()
    return {"ok": True}


@router.patch("/ocorrencias/status/lote", status_code=200)
async def update_status_lote(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_rh),
):
    """Atualiza o status de várias ocorrências de uma vez."""
    ids: list[str] = body.get("ids", [])
    novo_status: str = body.get("status", "")
    if novo_status not in ("pending", "approved", "ignored"):
        raise HTTPException(status_code=400, detail="Status inválido")
    if not ids:
        return {"atualizadas": 0}
    rows = (await db.execute(select(GpOcorrencia).where(GpOcorrencia.occurrence_id.in_(ids)))).scalars().all()
    for row in rows:
        row.status = novo_status
    await db.commit()
    return {"atualizadas": len(rows)}


@router.get("/info")
async def info(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_rh),
):
    """Resumo dos dados armazenados."""
    from sqlalchemy import func as sqlfunc
    total_colab = (await db.execute(select(sqlfunc.count()).select_from(GpColaborador))).scalar() or 0
    total_diarios = (await db.execute(select(sqlfunc.count()).select_from(GpRegistroDiario))).scalar() or 0
    total_occ = (await db.execute(select(sqlfunc.count()).select_from(GpOcorrencia))).scalar() or 0
    total_banco = (await db.execute(select(sqlfunc.count()).select_from(GpBancoHoras))).scalar() or 0
    return {
        "colaboradores": total_colab,
        "registrosDiarios": total_diarios,
        "ocorrencias": total_occ,
        "bancoHoras": total_banco,
    }


# ─── Painel v1.5 (mesmo visual da versão local; dados no banco) ───────────────
# A tela da v1.5 lê e grava um único "snapshot" (base FPW + análise + ocorrências).
# Aqui ele fica numa linha de gp_painel, compartilhada por todos os usuários do RH.

import gzip as _gzip
import re as _re
from datetime import datetime as _dt, timezone as _tz
from fastapi import Request
from fastapi.responses import Response
from app.models.usuario import Usuario

_PAINEL_ID = 1
_EMAIL_RE = _re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_MAX_CORPO = 200 * 1024 * 1024  # 200 MB descompactado


def _acesso(user: Usuario) -> dict:
    return {
        "role": "admin", "canManage": True, "label": "RH · Dados no sistema",
        "supervisorEmails": [], "email": user.email, "displayName": user.nome,
    }


async def _painel(db: AsyncSession) -> GpPainel:
    painel = await db.get(GpPainel, _PAINEL_ID)
    if painel is None:
        painel = GpPainel(id=_PAINEL_ID, analysis_version=0, dados=None, rh_email="", updated_by="")
        db.add(painel)
        await db.flush()
    return painel


def _iso(valor) -> str:
    if not valor:
        return ""
    if valor.tzinfo is None:
        valor = valor.replace(tzinfo=_tz.utc)
    return valor.isoformat()


def _resumo(painel: GpPainel) -> dict:
    return {"analysisVersion": painel.analysis_version, "updatedAt": _iso(painel.updated_at),
            "updatedByEmail": painel.updated_by}


async def _corpo_json(request: Request):
    corpo = await request.body()
    if request.headers.get("content-encoding", "").lower() == "gzip":
        try:
            corpo = _gzip.decompress(corpo)
        except OSError:
            raise HTTPException(400, "Corpo compactado inválido")
    if len(corpo) > _MAX_CORPO:
        raise HTTPException(413, "Dados grandes demais")
    try:
        return json.loads(corpo)
    except ValueError:
        raise HTTPException(400, "JSON inválido")


@router.get("/painel")
async def painel_obter(db: AsyncSession = Depends(get_db), user: Usuario = Depends(require_admin_ou_rh)):
    """Snapshot do painel + acesso do usuário + e-mail do RH (o JSON salvo é devolvido sem reprocessar)."""
    painel = await db.get(GpPainel, _PAINEL_ID)
    acesso = json.dumps(_acesso(user), ensure_ascii=False)
    rh = json.dumps(painel.rh_email if painel else "", ensure_ascii=False)
    if not painel or not painel.dados:
        corpo = f'{{"access":{acesso},"rhEmail":{rh},"snapshot":null}}'
    else:
        meta = _resumo(painel)
        corpo = (f'{{"access":{acesso},"rhEmail":{rh},"snapshot":{{"analysisVersion":{meta["analysisVersion"]},'
                 f'"updatedAt":{json.dumps(meta["updatedAt"])},"updatedByEmail":{json.dumps(meta["updatedByEmail"])},'
                 f'"data":{painel.dados}}}}}')
    return Response(content=corpo, media_type="application/json")


def _aplicar_status_legados(dados: dict, legados: dict[str, str]) -> int:
    """Primeira gravação no painel: aproveita os status já registrados na versão anterior."""
    alterados = 0
    for item in dados.get("items") or []:
        st = legados.get(item.get("id"))
        if st and st != "pending" and item.get("status") == "pending":
            item["status"] = st
            alterados += 1
    return alterados


def _chave_ocorrencia(item: dict) -> str:
    return f"{item.get('matricula')}|{item.get('date')}|{item.get('category')}"


def _aplicar_status_versao_anterior(dados: dict, anteriores: list) -> int:
    """Nova versão de análise: a tela reimporta do zero, então os status tratados/notificados
    do snapshot anterior são reaplicados pela mesma chave que a tela usa (matrícula|data|categoria)."""
    tratados = {_chave_ocorrencia(i): i for i in anteriores if isinstance(i, dict) and i.get("status", "pending") != "pending"}
    alterados = 0
    for item in dados.get("items") or []:
        antes = tratados.get(_chave_ocorrencia(item))
        if antes and item.get("status", "pending") == "pending":
            item["status"] = antes["status"]
            for campo in ("notifiedAt", "notificationMethod"):
                if antes.get(campo):
                    item[campo] = antes[campo]
            alterados += 1
    return alterados


@router.post("/painel")
async def painel_salvar(request: Request, db: AsyncSession = Depends(get_db), user: Usuario = Depends(require_admin_ou_rh)):
    """Grava o snapshot inteiro (importação da base, dos TXT mensais ou limpeza)."""
    payload = await _corpo_json(request)
    dados = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(dados, dict) or not isinstance(dados.get("contacts", []), list) or not isinstance(dados.get("items", []), list):
        raise HTTPException(400, "Formato de dados inválido")
    versao = payload.get("analysisVersion")
    if not isinstance(versao, int):
        raise HTTPException(400, "analysisVersion ausente")

    painel = await _painel(db)
    migrados = 0
    # Painel ainda sem ocorrências (vazio ou só com a base FPW): aproveita os status da versão anterior.
    # `dados` é gravado sem espaços, então a lista vazia aparece exatamente como "items":[]
    sem_ocorrencias = not painel.dados or '"items":[]' in painel.dados
    if sem_ocorrencias and dados.get("items"):
        res = await db.execute(select(GpOcorrencia.occurrence_id, GpOcorrencia.status).where(GpOcorrencia.status != "pending"))
        migrados = _aplicar_status_legados(dados, {i: st for i, st in res.all()})
    elif painel.dados and painel.analysis_version != versao and dados.get("items"):
        anteriores = json.loads(painel.dados).get("items") or []
        migrados = _aplicar_status_versao_anterior(dados, anteriores)

    painel.analysis_version = versao
    painel.dados = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))
    painel.updated_by = user.email
    painel.updated_at = _dt.now(_tz.utc)
    await db.flush()
    return {"snapshot": _resumo(painel), "statusAproveitados": migrados}


class _MudancaItem(BaseModel):
    id: str
    status: Literal["pending", "approved", "ignored"]
    notifiedAt: str | None = None
    notificationMethod: str | None = None


class _MudancasItens(BaseModel):
    changes: list[_MudancaItem]


@router.patch("/painel/itens")
async def painel_itens(data: _MudancasItens, db: AsyncSession = Depends(get_db), user: Usuario = Depends(require_admin_ou_rh)):
    """Atualiza só o status das ocorrências (evita reenviar o snapshot inteiro a cada clique)."""
    painel = await db.get(GpPainel, _PAINEL_ID)
    if not painel or not painel.dados:
        raise HTTPException(409, "Painel sem dados: importe a base e os TXT mensais")
    dados = json.loads(painel.dados)
    mudancas = {m.id: m for m in data.changes}
    alterados = 0
    for item in dados.get("items") or []:
        m = mudancas.get(item.get("id"))
        if not m:
            continue
        item["status"] = m.status
        for campo in ("notifiedAt", "notificationMethod"):
            valor = getattr(m, campo)
            if valor:
                item[campo] = valor
            else:
                item.pop(campo, None)
        alterados += 1
    painel.dados = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))
    painel.updated_by = user.email
    painel.updated_at = _dt.now(_tz.utc)
    await db.flush()
    return {"snapshot": _resumo(painel), "alterados": alterados}


class _ConfigPainel(BaseModel):
    rhEmail: str


@router.put("/painel/config")
async def painel_config(data: _ConfigPainel, db: AsyncSession = Depends(get_db), _=Depends(require_admin_ou_rh)):
    email = data.rhEmail.strip().lower()
    if email and not _EMAIL_RE.match(email):
        raise HTTPException(400, "Informe um e-mail válido do RH")
    painel = await _painel(db)
    painel.rh_email = email
    return {"rhEmail": email}
