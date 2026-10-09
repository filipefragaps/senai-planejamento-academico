"""
Contratos Virtuais — registro de docentes sem contrato formal ou que ministram
modalidade diferente (diferença de hora). Requer aprovação do administrador.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin
from app.database import get_db
from app.models.contrato_virtual import ContratoVirtual
from app.models.professor import Professor
from app.models.usuario import Usuario

router = APIRouter(prefix="/professores", tags=["Contratos Virtuais"])


class UcRef(BaseModel):
    uc_id: int
    uc_nome: str


class ContratoVirtualCreate(BaseModel):
    nome_completo: str
    cpf: str
    conta_corrente: str | None = None
    email: str | None = None
    telefone: str | None = None
    evento_id: int | None = None
    evento_nome: str | None = None
    ucs: list[UcRef] = []
    modalidade: str
    justificativa: str


class ContratoVirtualAprovar(BaseModel):
    acao: str  # "aprovar" | "rejeitar"


def _cv_out(cv: ContratoVirtual) -> dict:
    return {
        "id": cv.id,
        "professor_id": cv.professor_id,
        "nome_completo": cv.nome_completo,
        "cpf": cv.cpf,
        "conta_corrente": cv.conta_corrente,
        "email": cv.email,
        "telefone": cv.telefone,
        "evento_id": cv.evento_id,
        "evento_nome": cv.evento_nome,
        "ucs": cv.ucs or [],
        "modalidade": cv.modalidade,
        "justificativa": cv.justificativa,
        "status": cv.status,
        "aprovado_por": cv.aprovado_por,
        "aprovado_por_id": cv.aprovado_por_id,
        "aprovado_em": cv.aprovado_em.isoformat() if cv.aprovado_em else None,
        "criado_em": cv.criado_em.isoformat() if cv.criado_em else None,
    }


async def _get_professor(db: AsyncSession, professor_id: int) -> Professor:
    res = await db.execute(select(Professor).where(Professor.id == professor_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Professor não encontrado")
    return p


# Static route MUST come before /{professor_id} to avoid path conflict
@router.get("/contratos-virtuais/pendentes")
async def listar_pendentes(
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_admin),
):
    res = await db.execute(
        select(ContratoVirtual, Professor.nome.label("professor_nome"))
        .join(Professor, ContratoVirtual.professor_id == Professor.id)
        .where(ContratoVirtual.status == "pendente")
        .order_by(ContratoVirtual.criado_em.asc())
    )
    rows = res.all()
    result = []
    for row in rows:
        out = _cv_out(row.ContratoVirtual)
        out["professor_nome"] = row.professor_nome
        result.append(out)
    return result


@router.get("/{professor_id}/contratos-virtuais")
async def listar_contratos_virtuais(
    professor_id: int,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    await _get_professor(db, professor_id)
    res = await db.execute(
        select(ContratoVirtual)
        .where(ContratoVirtual.professor_id == professor_id)
        .order_by(ContratoVirtual.criado_em.desc())
    )
    return [_cv_out(cv) for cv in res.scalars().all()]


@router.post("/{professor_id}/contratos-virtuais", status_code=201)
async def criar_contrato_virtual(
    professor_id: int,
    data: ContratoVirtualCreate,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    await _get_professor(db, professor_id)

    if not data.justificativa.strip():
        raise HTTPException(400, "Justificativa é obrigatória")
    if not data.modalidade:
        raise HTTPException(400, "Modalidade é obrigatória")

    cv = ContratoVirtual(
        professor_id=professor_id,
        nome_completo=data.nome_completo,
        cpf=data.cpf,
        conta_corrente=data.conta_corrente,
        email=data.email,
        telefone=data.telefone,
        evento_id=data.evento_id,
        evento_nome=data.evento_nome,
        ucs=[u.model_dump() for u in data.ucs] if data.ucs else [],
        modalidade=data.modalidade,
        justificativa=data.justificativa,
        status="pendente",
    )
    db.add(cv)
    await db.commit()
    await db.refresh(cv)
    return _cv_out(cv)


@router.patch("/{professor_id}/contratos-virtuais/{cv_id}/aprovar")
async def aprovar_contrato_virtual(
    professor_id: int,
    cv_id: int,
    data: ContratoVirtualAprovar,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_admin),
):
    res = await db.execute(
        select(ContratoVirtual).where(
            ContratoVirtual.id == cv_id,
            ContratoVirtual.professor_id == professor_id,
        )
    )
    cv = res.scalar_one_or_none()
    if not cv:
        raise HTTPException(404, "Contrato virtual não encontrado")

    if data.acao not in ("aprovar", "rejeitar"):
        raise HTTPException(400, "Ação inválida. Use 'aprovar' ou 'rejeitar'")

    cv.status = "aprovado" if data.acao == "aprovar" else "rejeitado"
    cv.aprovado_por = current_user.nome
    cv.aprovado_por_id = current_user.id
    cv.aprovado_em = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(cv)
    return _cv_out(cv)
