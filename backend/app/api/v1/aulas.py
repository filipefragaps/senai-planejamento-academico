from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.database import get_db
from app.models.aula import Aula
from app.schemas.evento import AulaOut, AulaUpdate, ReplanejamentoRequest, ReplanejamentoResponse
from app.services.replanejamento import alterar_aula_e_replaneja
from app.algorithms.constraint_solver import encontrar_professor_alternativo
from app.models.evento import Evento
from app.core.deps import get_current_user

router = APIRouter(prefix="/aulas", tags=["Aulas"])


@router.get("/", response_model=list[AulaOut])
async def listar_aulas(
    evento_id: int | None = None,
    professor_id: int | None = None,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(Aula)
    filters = []
    if evento_id:
        filters.append(Aula.evento_id == evento_id)
    if professor_id:
        filters.append(Aula.professor_id == professor_id)
    if data_inicio:
        filters.append(Aula.data >= data_inicio)
    if data_fim:
        filters.append(Aula.data <= data_fim)
    if status:
        filters.append(Aula.status == status)
    if filters:
        query = query.where(and_(*filters))
    result = await db.execute(query.order_by(Aula.data, Aula.horario_inicio))
    return result.scalars().all()


@router.get("/{aula_id}", response_model=AulaOut)
async def obter_aula(aula_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(Aula).where(Aula.id == aula_id))
    aula = result.scalar_one_or_none()
    if not aula:
        raise HTTPException(status_code=404, detail="Aula não encontrada")
    return aula


@router.put("/{aula_id}", response_model=ReplanejamentoResponse)
async def alterar_aula(
    aula_id: int,
    data: ReplanejamentoRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Altera uma aula e repleja automaticamente as aulas futuras."""
    try:
        alteracoes = data.alteracoes.model_dump(exclude_unset=True, exclude={"motivo"})
        resultado = await alterar_aula_e_replaneja(
            aula_id=aula_id,
            alteracoes=alteracoes,
            replaneja_futuras=data.replaneja_futuras,
            motivo=data.motivo,
            usuario_id=current_user.id,
            db=db,
        )
        await db.commit()

        # Buscar sugestões de professor alternativo se houve conflitos
        sugestoes_ia = []
        if resultado["conflitos_detectados"]:
            result_aula = await db.execute(select(Aula).where(Aula.id == aula_id))
            aula = result_aula.scalar_one()
            result_ev = await db.execute(select(Evento).where(Evento.id == aula.evento_id))
            evento = result_ev.scalar_one()
            alternativas = await encontrar_professor_alternativo(
                evento, aula.data, aula.horario_inicio, aula.horario_fim, db
            )
            if alternativas:
                nomes = [a["nome"] for a in alternativas[:3]]
                sugestoes_ia = [f"Professor disponível: {n}" for n in nomes]

        return ReplanejamentoResponse(
            aula_alterada=resultado["aula_alterada"],
            aulas_replanejadas=resultado["aulas_replanejadas"],
            conflitos_detectados=resultado["conflitos_detectados"],
            sugestoes_ia=sugestoes_ia,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{aula_id}/alternativas")
async def buscar_alternativas(
    aula_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Busca professores alternativos para uma aula."""
    result = await db.execute(select(Aula).where(Aula.id == aula_id))
    aula = result.scalar_one_or_none()
    if not aula:
        raise HTTPException(status_code=404, detail="Aula não encontrada")

    result_ev = await db.execute(select(Evento).where(Evento.id == aula.evento_id))
    evento = result_ev.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")

    alternativas = await encontrar_professor_alternativo(
        evento, aula.data, aula.horario_inicio, aula.horario_fim, db
    )
    return {"aula_id": aula_id, "alternativas": alternativas}
