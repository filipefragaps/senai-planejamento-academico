from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.curso import Curso
from app.models.unidade_curricular import UnidadeCurricular
from app.schemas.curso import CursoCreate, CursoUpdate, CursoOut, UCCreate, UCUpdate, UCOut, UCReorderItem
from app.core.deps import get_current_user

router = APIRouter(prefix="/cursos", tags=["Cursos"])


def _uc_dict(uc: UnidadeCurricular) -> dict:
    return {
        "id": uc.id,
        "curso_id": uc.curso_id,
        "codigo_uc": uc.codigo_uc,
        "nome": uc.nome,
        "tipo": uc.tipo,
        "modulo_etapa": uc.modulo_etapa,
        "sequencia": uc.sequencia,
        "carga_horaria": uc.carga_horaria,
    }


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


# ── UC endpoints ───────────────────────────────────────────────────────────────

@router.get("/{curso_id}/ucs")
async def listar_ucs(curso_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Retorna a estrutura curricular (UCs) de um curso ordenada por módulo e sequência."""
    res_c = await db.execute(select(Curso).where(Curso.id == curso_id))
    if not res_c.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Curso não encontrado")

    res = await db.execute(
        select(UnidadeCurricular)
        .where(UnidadeCurricular.curso_id == curso_id)
        .order_by(UnidadeCurricular.modulo_etapa, UnidadeCurricular.sequencia)
    )
    return [_uc_dict(uc) for uc in res.scalars().all()]


@router.post("/{curso_id}/ucs", response_model=UCOut, status_code=201)
async def criar_uc(
    curso_id: int,
    data: UCCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    res_c = await db.execute(select(Curso).where(Curso.id == curso_id))
    if not res_c.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Curso não encontrado")

    codigo_uc = data.codigo_uc.strip() if data.codigo_uc and data.codigo_uc.strip() else None
    if not codigo_uc:
        # Gera código sequencial único para o curso
        count_res = await db.execute(
            select(func.count()).where(UnidadeCurricular.curso_id == curso_id)
        )
        n = (count_res.scalar() or 0) + 1
        codigo_uc = f"UC{n:03d}"

    # Garante unicidade dentro do curso
    existing = await db.execute(
        select(UnidadeCurricular).where(
            UnidadeCurricular.curso_id == curso_id,
            UnidadeCurricular.codigo_uc == codigo_uc,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Código UC '{codigo_uc}' já existe neste curso")

    # Sequência automática dentro do módulo se não fornecida
    seq = data.sequencia
    if seq is None:
        seq_res = await db.execute(
            select(func.count()).where(
                UnidadeCurricular.curso_id == curso_id,
                UnidadeCurricular.modulo_etapa == data.modulo_etapa,
            )
        )
        seq = (seq_res.scalar() or 0) + 1

    uc = UnidadeCurricular(
        curso_id=curso_id,
        codigo_uc=codigo_uc,
        nome=data.nome,
        tipo=data.tipo,
        modulo_etapa=data.modulo_etapa or None,
        sequencia=seq,
        carga_horaria=data.carga_horaria,
    )
    db.add(uc)
    await db.commit()
    await db.refresh(uc)
    return uc


@router.put("/{curso_id}/ucs/{uc_id}", response_model=UCOut)
async def atualizar_uc(
    curso_id: int,
    uc_id: int,
    data: UCUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    res = await db.execute(
        select(UnidadeCurricular).where(
            UnidadeCurricular.id == uc_id,
            UnidadeCurricular.curso_id == curso_id,
        )
    )
    uc = res.scalar_one_or_none()
    if not uc:
        raise HTTPException(status_code=404, detail="UC não encontrada")

    updates = data.model_dump(exclude_unset=True)

    # Se mudou o codigo_uc, verifica unicidade
    if "codigo_uc" in updates and updates["codigo_uc"] != uc.codigo_uc:
        check = await db.execute(
            select(UnidadeCurricular).where(
                UnidadeCurricular.curso_id == curso_id,
                UnidadeCurricular.codigo_uc == updates["codigo_uc"],
                UnidadeCurricular.id != uc_id,
            )
        )
        if check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Código UC já existe neste curso")

    for campo, valor in updates.items():
        setattr(uc, campo, valor)

    await db.commit()
    await db.refresh(uc)
    return uc


@router.delete("/{curso_id}/ucs/{uc_id}", status_code=204)
async def deletar_uc(
    curso_id: int,
    uc_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    res = await db.execute(
        select(UnidadeCurricular).where(
            UnidadeCurricular.id == uc_id,
            UnidadeCurricular.curso_id == curso_id,
        )
    )
    uc = res.scalar_one_or_none()
    if not uc:
        raise HTTPException(status_code=404, detail="UC não encontrada")
    await db.delete(uc)
    await db.commit()


@router.patch("/{curso_id}/ucs/reorder", status_code=204)
async def reordenar_ucs(
    curso_id: int,
    items: list[UCReorderItem],
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Atualiza sequencia (e opcionalmente modulo_etapa) de múltiplas UCs de uma vez."""
    ids = [i.id for i in items]
    res = await db.execute(
        select(UnidadeCurricular).where(
            UnidadeCurricular.curso_id == curso_id,
            UnidadeCurricular.id.in_(ids),
        )
    )
    ucs = {uc.id: uc for uc in res.scalars().all()}

    for item in items:
        uc = ucs.get(item.id)
        if uc:
            uc.sequencia = item.sequencia
            if item.modulo_etapa is not None:
                uc.modulo_etapa = item.modulo_etapa or None

    await db.commit()
