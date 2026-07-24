from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.evento import Evento
from app.models.aula import Aula
from app.models.curso import Curso
from app.schemas.evento import EventoCreate, EventoUpdate, EventoOut, EventoComAulas
from app.algorithms.constraint_solver import gerar_aulas_evento
from app.core.deps import get_current_user

router = APIRouter(prefix="/eventos", tags=["Eventos / Turmas"])


@router.get("/")
async def listar_eventos(
    status: str | None = None,
    professor_id: int | None = None,
    curso_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(Evento)
    if status:
        query = query.where(Evento.status == status)
    if professor_id:
        query = query.where(Evento.professor_id == professor_id)
    if curso_id:
        query = query.where(Evento.curso_id == curso_id)
    result = await db.execute(query.order_by(Evento.data_inicio.desc()))
    eventos_list = result.scalars().all()

    # Batch-fetch course names to include in response
    ids_curso = {e.curso_id for e in eventos_list if e.curso_id}
    cursos: dict[int, str] = {}
    if ids_curso:
        res = await db.execute(select(Curso).where(Curso.id.in_(ids_curso)))
        cursos = {c.id: c.nome for c in res.scalars().all()}

    out = []
    for e in eventos_list:
        d = EventoOut.model_validate(e).model_dump()
        d["nome_curso"] = cursos.get(e.curso_id)
        out.append(d)
    return out


@router.post("/", response_model=EventoComAulas, status_code=201)
async def criar_evento(
    data: EventoCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    evento_data = data.model_dump(exclude={"gerar_aulas"})
    evento = Evento(**evento_data)
    db.add(evento)
    await db.flush()  # Get the ID

    conflitos = []
    if data.gerar_aulas:
        _, conflitos = await gerar_aulas_evento(evento, db)

    await db.commit()
    await db.refresh(evento)

    # Reload with aulas
    result = await db.execute(
        select(Evento).options(selectinload(Evento.aulas)).where(Evento.id == evento.id)
    )
    evento_completo = result.scalar_one()

    if conflitos:
        # Add conflict info to response headers via custom field
        evento_completo.__dict__["_conflitos"] = conflitos

    return evento_completo


@router.get("/{evento_id}", response_model=EventoComAulas)
async def obter_evento(
    evento_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(Evento).options(selectinload(Evento.aulas)).where(Evento.id == evento_id)
    )
    evento = result.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    return evento


@router.put("/{evento_id}", response_model=EventoOut)
async def atualizar_evento(
    evento_id: int,
    data: EventoUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")

    for campo, valor in data.model_dump(exclude_unset=True).items():
        setattr(evento, campo, valor)
    await db.commit()
    await db.refresh(evento)
    return evento


@router.post("/{evento_id}/gerar-aulas")
async def gerar_aulas(
    evento_id: int,
    substituir: bool = False,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")

    if substituir:
        result_aulas = await db.execute(
            select(Aula).where(Aula.evento_id == evento_id, Aula.alterada_manualmente == False)
        )
        for aula in result_aulas.scalars().all():
            await db.delete(aula)
        await db.flush()

    aulas, conflitos = await gerar_aulas_evento(evento, db)
    await db.commit()

    return {
        "aulas_geradas": len(aulas),
        "conflitos": conflitos,
        "total_conflitos": len(conflitos),
    }


@router.delete("/{evento_id}", status_code=204)
async def deletar_evento(
    evento_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    await db.delete(evento)
    await db.commit()
