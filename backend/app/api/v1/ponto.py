"""Ponto batido para a Regência: horas por professor e mês, lidas direto da Gestão de Ponto
(não há mais planilha de ponto para importar)."""
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.services import ponto_gestao

router = APIRouter(prefix="/ponto", tags=["Ponto Batido"])


@router.get("/stats")
async def stats_ponto(
    data_inicio: date,
    data_fim: date,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Retorna horas_total por professor_id para o período (para exibir regência real na listagem)."""
    total: dict[int, float] = defaultdict(float)
    for r in await ponto_gestao.registros(db, data_inicio, data_fim):
        total[r.professor_id] += r.horas_total
    return {str(pid): round(h, 2) for pid, h in total.items()}


@router.get("/info")
async def info_ponto(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Resumo dos dados de ponto (última atualização da Gestão de Ponto e período coberto)."""
    return await ponto_gestao.info(db)


@router.get("/professor/{professor_id}")
async def ponto_professor(
    professor_id: int,
    data_inicio: date,
    data_fim: date,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Retorna os registros de ponto do professor no período solicitado.
    Inclui os meses (civis) que se sobrepõem ao filtro.
    """
    registros = await ponto_gestao.registros(db, data_inicio, data_fim, {professor_id})

    total_extras = sum(r.horas_extras or 0 for r in registros)
    total_horas  = sum(r.horas_total  or 0 for r in registros)

    return {
        "registros": [
            {
                "id": r.id,
                "nome_colaborador": r.nome_colaborador,
                "data_inicio": r.data_inicio.isoformat(),
                "data_fim": r.data_fim.isoformat(),
                "horas_efetivas": round(r.horas_efetivas or 0, 2),
                "horas_extras": round(r.horas_extras or 0, 2),
                "horas_total": round(r.horas_total or 0, 2),
            }
            for r in registros
        ],
        "totais": {
            "horas_efetivas": 0,
            "horas_extras": round(total_extras, 2),
            "horas_total": round(total_horas, 2),
        },
    }
