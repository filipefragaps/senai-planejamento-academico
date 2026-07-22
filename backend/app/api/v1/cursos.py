from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.curso import Curso
from app.models.unidade_curricular import UnidadeCurricular
from app.schemas.curso import CursoCreate, CursoUpdate, CursoOut
from app.core.deps import get_current_user

router = APIRouter(prefix="/cursos", tags=["Cursos"])


@router.get("/", response_model=list[CursoOut])
async def listar_cursos(
    ativo: bool | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(Curso)
    if ativo is not None:
        query = query.where(Curso.ativo == ativo)
    result = await db.execute(query.order_by(Curso.nome))
    return result.scalars().all()


@router.post("/", response_model=CursoOut, status_code=201)
async def criar_curso(
    data: CursoCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Curso).where(Curso.codigo == data.codigo))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Código de curso já existe")

    curso = Curso(**data.model_dump())
    db.add(curso)
    await db.commit()
    await db.refresh(curso)
    return curso


@router.get("/{curso_id}", response_model=CursoOut)
async def obter_curso(curso_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(Curso).where(Curso.id == curso_id))
    curso = result.scalar_one_or_none()
    if not curso:
        raise HTTPException(status_code=404, detail="Curso não encontrado")
    return curso


@router.put("/{curso_id}", response_model=CursoOut)
async def atualizar_curso(
    curso_id: int,
    data: CursoUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Curso).where(Curso.id == curso_id))
    curso = result.scalar_one_or_none()
    if not curso:
        raise HTTPException(status_code=404, detail="Curso não encontrado")

    for campo, valor in data.model_dump(exclude_unset=True).items():
        setattr(curso, campo, valor)
    await db.commit()
    await db.refresh(curso)
    return curso


@router.delete("/{curso_id}", status_code=204)
async def deletar_curso(curso_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(Curso).where(Curso.id == curso_id))
    curso = result.scalar_one_or_none()
    if not curso:
        raise HTTPException(status_code=404, detail="Curso não encontrado")
    await db.delete(curso)
    await db.commit()


@router.get("/{curso_id}/ucs")
async def listar_ucs(curso_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Retorna a estrutura curricular (UCs) de um curso agrupada por módulo/etapa."""
    res_c = await db.execute(select(Curso).where(Curso.id == curso_id))
    if not res_c.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Curso não encontrado")

    res = await db.execute(
        select(UnidadeCurricular)
        .where(UnidadeCurricular.curso_id == curso_id)
        .order_by(UnidadeCurricular.modulo_etapa, UnidadeCurricular.sequencia)
    )
    ucs = res.scalars().all()
    return [
        {
            "id": uc.id,
            "codigo_uc": uc.codigo_uc,
            "nome": uc.nome,
            "tipo": uc.tipo,
            "modulo_etapa": uc.modulo_etapa,
            "sequencia": uc.sequencia,
            "carga_horaria": uc.carga_horaria,
        }
        for uc in ucs
    ]
