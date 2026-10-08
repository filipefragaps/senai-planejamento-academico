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
    GpColaborador, GpRegistroDiario, GpOcorrencia, GpBancoHoras, GpImportacao,
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
