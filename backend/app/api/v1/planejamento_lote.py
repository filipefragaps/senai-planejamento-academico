"""Planejamento em lote: todos os eventos de um curso, professores escolhidos em conjunto."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.services.planejamento_lote import eventos_do_curso, preview_lote

router = APIRouter(prefix="/planejamento-lote", tags=["Planejamento em lote"])


class EventoLote(BaseModel):
    evento_id: int
    modulo: Optional[str] = None
    data_inicio: Optional[str] = None
    modo_superior: bool = False
    clipar_semestre: bool = False


class Trava(BaseModel):
    evento_id: int
    uc_id: int
    professor_id: int


class PreviewLoteRequest(BaseModel):
    curso_id: int
    eventos: list[EventoLote]
    travas: list[Trava] = []


@router.get("/eventos/{curso_id}")
async def listar_eventos(curso_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Eventos ativos do curso, com as etapas já planejadas e a próxima sugerida."""
    return await eventos_do_curso(db, curso_id)


@router.post("/preview")
async def gerar_preview(body: PreviewLoteRequest, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Gera a proposta do lote (não grava). Para gravar, confirme cada evento em /planejamento/confirmar."""
    if not body.eventos:
        raise HTTPException(status_code=422, detail="Selecione ao menos um evento.")
    try:
        return await preview_lote(
            db, body.curso_id,
            [e.model_dump() for e in body.eventos],
            [t.model_dump() for t in body.travas],
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
