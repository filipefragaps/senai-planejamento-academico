from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, extract

from app.database import get_db
from app.core.deps import get_current_user
from app.models.calendario import CalendarioAcademico

router = APIRouter(prefix="/calendario", tags=["Calendário Acadêmico"])

TIPOS_NAO_LETIVOS = {"feriado", "recesso", "férias", "ferias", "folga", "compensacao", "compensação", "sem aula"}


class EntradaCalendario(BaseModel):
    data: str          # "YYYY-MM-DD"
    tipo: str          # Feriado | Recesso | Folga | Evento | Sem aula
    descricao: Optional[str] = None
    letivo: bool = False
    periodo: Optional[str] = None


@router.get("/")
async def listar_calendario(
    ano: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Lista entradas do calendário acadêmico, opcionalmente filtradas por ano."""
    query = select(CalendarioAcademico).order_by(CalendarioAcademico.data)
    if ano:
        query = query.where(extract("year", CalendarioAcademico.data) == ano)
    result = await db.execute(query)
    entradas = result.scalars().all()
    return [
        {
            "id": e.id,
            "data": e.data.isoformat(),
            "tipo": e.tipo,
            "letivo": e.letivo,
            "descricao": e.descricao,
            "periodo": e.periodo,
        }
        for e in entradas
    ]


@router.post("/", status_code=201)
async def criar_entrada(
    body: EntradaCalendario,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Cria ou atualiza uma entrada no calendário (upsert por data + tipo)."""
    try:
        data_obj = date.fromisoformat(body.data)
    except ValueError:
        raise HTTPException(status_code=422, detail="Data inválida. Use YYYY-MM-DD.")

    # Upsert: se já existe para esta data+tipo, atualiza
    result = await db.execute(
        select(CalendarioAcademico).where(
            and_(
                CalendarioAcademico.data == data_obj,
                CalendarioAcademico.tipo == body.tipo,
            )
        )
    )
    entrada = result.scalar_one_or_none()

    if entrada:
        entrada.descricao = body.descricao
        entrada.letivo = body.letivo
        entrada.periodo = body.periodo
    else:
        entrada = CalendarioAcademico(
            data=data_obj,
            tipo=body.tipo,
            letivo=body.letivo,
            descricao=body.descricao,
            periodo=body.periodo,
        )
        db.add(entrada)

    await db.commit()
    await db.refresh(entrada)
    return {
        "id": entrada.id,
        "data": entrada.data.isoformat(),
        "tipo": entrada.tipo,
        "letivo": entrada.letivo,
        "descricao": entrada.descricao,
        "periodo": entrada.periodo,
    }


@router.put("/{entrada_id}")
async def atualizar_entrada(
    entrada_id: int,
    body: EntradaCalendario,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(CalendarioAcademico).where(CalendarioAcademico.id == entrada_id))
    entrada = result.scalar_one_or_none()
    if not entrada:
        raise HTTPException(status_code=404, detail="Entrada não encontrada")

    try:
        entrada.data = date.fromisoformat(body.data)
    except ValueError:
        raise HTTPException(status_code=422, detail="Data inválida.")

    entrada.tipo = body.tipo
    entrada.letivo = body.letivo
    entrada.descricao = body.descricao
    entrada.periodo = body.periodo
    await db.commit()
    await db.refresh(entrada)
    return {
        "id": entrada.id,
        "data": entrada.data.isoformat(),
        "tipo": entrada.tipo,
        "letivo": entrada.letivo,
        "descricao": entrada.descricao,
        "periodo": entrada.periodo,
    }


@router.delete("/{entrada_id}", status_code=204)
async def deletar_entrada(
    entrada_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(CalendarioAcademico).where(CalendarioAcademico.id == entrada_id))
    entrada = result.scalar_one_or_none()
    if not entrada:
        raise HTTPException(status_code=404, detail="Entrada não encontrada")
    await db.delete(entrada)
    await db.commit()
