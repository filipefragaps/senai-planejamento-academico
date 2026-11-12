"""Impacto financeiro da regência (ganho com a melhoria e oportunidade até a meta)."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.services import regencia_financeiro as svc

router = APIRouter(prefix="/regencia-financeiro", tags=["Regência — impacto financeiro"])


@router.get("")
async def impacto_financeiro(
    data_inicio: date, data_fim: date, valor_hora: float,
    fonte: str = "auto", mes_base: Optional[str] = None,
    area: Optional[str] = None, modalidade: Optional[str] = None,
    db: AsyncSession = Depends(get_db), _=Depends(get_current_user),
):
    if data_fim < data_inicio:
        raise HTTPException(400, "A data final é anterior à inicial")
    if valor_hora < 0:
        raise HTTPException(400, "O valor da hora não pode ser negativo")
    if fonte not in ("auto", "real", "planejada"):
        raise HTTPException(400, "Fonte inválida")
    return await svc.calcular(db, data_inicio, data_fim, valor_hora, date.today(), fonte, mes_base, area, modalidade)
