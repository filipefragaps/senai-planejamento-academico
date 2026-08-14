"""
Contratos de Docentes (PJ / RPA / Inclusão em Folha).
CRUD vinculado ao professor — prefixo /professores/{id}/contratos.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_admin
from app.database import get_db
from app.models.contrato import ContratoDocente
from app.models.pagamento import PagamentoAula
from app.models.professor import Professor

router = APIRouter(prefix="/professores", tags=["Contratos de Docentes"])

TIPOS_CONTRATO = {"PJ", "RPA", "Inclusão em Folha"}


class ContratoCreate(BaseModel):
    numero_contrato: str
    valor_hora: float
    total_horas_previstas: float
    descricao: str | None = None
    ativo: bool = True


class ContratoUpdate(BaseModel):
    numero_contrato: str | None = None
    valor_hora: float | None = None
    total_horas_previstas: float | None = None
    descricao: str | None = None
    ativo: bool | None = None


async def _stats_contrato(db: AsyncSession, contrato_id: int) -> tuple[float, float]:
    """Retorna (horas_pagas, horas_encaminhadas) para um contrato."""
    r_pago = await db.execute(
        select(func.coalesce(func.sum(PagamentoAula.horas), 0))
        .where(PagamentoAula.contrato_id == contrato_id, PagamentoAula.status == "pago")
    )
    r_enc = await db.execute(
        select(func.coalesce(func.sum(PagamentoAula.horas), 0))
        .where(PagamentoAula.contrato_id == contrato_id, PagamentoAula.status == "encaminhado")
    )
    return float(r_pago.scalar()), float(r_enc.scalar())


def _contrato_out(c: ContratoDocente, h_pagas: float, h_enc: float) -> dict:
    vh = float(c.valor_hora)
    hp = float(c.total_horas_previstas)
    h_util = h_pagas + h_enc
    saldo = hp - h_util
    return {
        "id": c.id,
        "professor_id": c.professor_id,
        "numero_contrato": c.numero_contrato,
        "valor_hora": vh,
        "total_horas_previstas": hp,
        "descricao": c.descricao,
        "ativo": c.ativo,
        "criado_em": c.criado_em.isoformat() if c.criado_em else None,
        # computados
        "horas_pagas": round(h_pagas, 2),
        "horas_encaminhadas": round(h_enc, 2),
        "horas_utilizadas": round(h_util, 2),
        "saldo_horas": round(saldo, 2),
        "valor_total": round(vh * hp, 2),
        "valor_pago": round(vh * h_pagas, 2),
        "valor_encaminhado": round(vh * h_enc, 2),
        "saldo_financeiro": round(vh * saldo, 2),
        "percentual_utilizado": round((h_util / hp * 100) if hp > 0 else 0, 1),
    }


async def _get_professor(db: AsyncSession, professor_id: int) -> Professor:
    res = await db.execute(select(Professor).where(Professor.id == professor_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Professor não encontrado")
    return p


async def _get_contrato(db: AsyncSession, professor_id: int, contrato_id: int) -> ContratoDocente:
    res = await db.execute(
        select(ContratoDocente).where(
            ContratoDocente.id == contrato_id,
            ContratoDocente.professor_id == professor_id,
        )
    )
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Contrato não encontrado")
    return c


@router.get("/{professor_id}/contratos")
async def listar_contratos(
    professor_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    await _get_professor(db, professor_id)
    res = await db.execute(
        select(ContratoDocente)
        .where(ContratoDocente.professor_id == professor_id)
        .order_by(ContratoDocente.criado_em.desc())
    )
    contratos = res.scalars().all()
    result = []
    for c in contratos:
        h_p, h_e = await _stats_contrato(db, c.id)
        result.append(_contrato_out(c, h_p, h_e))
    return result


@router.post("/{professor_id}/contratos", status_code=201)
async def criar_contrato(
    professor_id: int,
    data: ContratoCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    prof = await _get_professor(db, professor_id)
    if prof.tipo not in TIPOS_CONTRATO:
        raise HTTPException(400, f"Contratos disponíveis apenas para tipos: {', '.join(TIPOS_CONTRATO)}")

    c = ContratoDocente(
        professor_id=professor_id,
        numero_contrato=data.numero_contrato,
        valor_hora=data.valor_hora,
        total_horas_previstas=data.total_horas_previstas,
        descricao=data.descricao,
        ativo=data.ativo,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _contrato_out(c, 0.0, 0.0)


@router.put("/{professor_id}/contratos/{contrato_id}")
async def atualizar_contrato(
    professor_id: int,
    contrato_id: int,
    data: ContratoUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    c = await _get_contrato(db, professor_id, contrato_id)
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(c, field, val)
    await db.commit()
    await db.refresh(c)
    h_p, h_e = await _stats_contrato(db, c.id)
    return _contrato_out(c, h_p, h_e)


@router.delete("/{professor_id}/contratos/{contrato_id}", status_code=204)
async def deletar_contrato(
    professor_id: int,
    contrato_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    c = await _get_contrato(db, professor_id, contrato_id)

    res_ativo = await db.execute(
        select(PagamentoAula).where(
            PagamentoAula.contrato_id == contrato_id,
            PagamentoAula.status.in_(["encaminhado", "pago"]),
        )
    )
    if res_ativo.scalar_one_or_none():
        raise HTTPException(400, "Contrato possui pagamentos ativos. Reverta-os antes de excluir.")

    await db.delete(c)
    await db.commit()
