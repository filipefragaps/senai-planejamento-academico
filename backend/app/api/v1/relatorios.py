from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
import io
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.excel_export import (
    exportar_cronograma_professor,
    exportar_regencia_excel,
    exportar_cronograma_turma,
    exportar_dados_mestres,
    exportar_ofertas_formatado,
    exportar_historico_aulas,
)
from app.core.deps import get_current_user

router = APIRouter(prefix="/relatorios", tags=["Relatórios / Exportação"])


@router.get("/cronograma-professor/{professor_id}")
async def exportar_professor_excel(
    professor_id: int,
    data_inicio: date,
    data_fim: date,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    try:
        content = await exportar_cronograma_professor(professor_id, data_inicio, data_fim, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=cronograma_prof_{professor_id}.xlsx"},
    )


@router.get("/regencia")
async def exportar_regencia(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    content = await exportar_regencia_excel(db)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=regencia_docente.xlsx"},
    )


@router.get("/cronograma-turma/{evento_id}")
async def exportar_turma_excel(
    evento_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    try:
        content = await exportar_cronograma_turma(evento_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=cronograma_turma_{evento_id}.xlsx"},
    )


@router.get("/dados-mestres")
async def exportar_dados_mestres_endpoint(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    content = await exportar_dados_mestres(db)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=dados_mestres.xlsx"},
    )


@router.get("/ofertas")
async def exportar_ofertas_endpoint(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    content = await exportar_ofertas_formatado(db)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=ofertas_senai.xlsx"},
    )


@router.get("/historico")
async def exportar_historico_endpoint(
    evento_id: Optional[int] = Query(None),
    professor_id: Optional[int] = Query(None),
    data_inicio: Optional[date] = Query(None),
    data_fim: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    content = await exportar_historico_aulas(
        db, evento_id=evento_id, professor_id=professor_id,
        data_inicio=data_inicio, data_fim=data_fim,
    )
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=cronograma.xlsx"},
    )
