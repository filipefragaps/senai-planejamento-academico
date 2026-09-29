from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete

from app.database import get_db
from app.models.ponto import PontoMensal
from app.core.deps import get_current_user, require_admin_ou_coordenador
from app.config import settings

router = APIRouter(prefix="/ponto", tags=["Ponto Batido"])


@router.post("/importar", status_code=201)
async def importar_ponto(
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_coordenador),
):
    """Importa planilha Excel de ponto batido. Substitui registros dos meses presentes no arquivo."""
    nome = (arquivo.filename or "").lower()
    if not nome.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    tamanho_max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    conteudo = await arquivo.read()
    if len(conteudo) > tamanho_max:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máximo {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        from app.services.csv_import_ponto import importar_ponto as _importar
        resultado = await _importar(conteudo, db)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar arquivo: {e}")

    return {
        "sucesso": True,
        "inseridos": resultado["inseridos"],
        "erros": resultado["erros"],
        "periodos": resultado["periodos"],
        "mensagem": (
            f"{resultado['inseridos']} registros importados em {resultado['periodos']} mês(es)"
            f" ({resultado['erros']} ignorados)."
        ),
    }


@router.delete("/limpar", status_code=200)
async def limpar_ponto(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_coordenador),
):
    """Remove todos os registros de ponto do banco."""
    result = await db.execute(delete(PontoMensal))
    await db.commit()
    return {"removidos": result.rowcount}


@router.get("/info")
async def info_ponto(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Resumo dos dados importados de ponto."""
    total = (await db.execute(select(func.count()).select_from(PontoMensal))).scalar() or 0
    ultimo = (await db.execute(select(func.max(PontoMensal.importado_em)))).scalar()
    data_min = (await db.execute(select(func.min(PontoMensal.data_inicio)))).scalar()
    data_max = (await db.execute(select(func.max(PontoMensal.data_fim)))).scalar()
    return {
        "total": total,
        "importado_em": ultimo.isoformat() if ultimo else None,
        "data_inicio": data_min.isoformat() if data_min else None,
        "data_fim": data_max.isoformat() if data_max else None,
    }


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
    Inclui registros cujo mês (data_inicio..data_fim) se sobrepõe ao filtro.
    """
    res = await db.execute(
        select(PontoMensal)
        .where(
            PontoMensal.professor_id == professor_id,
            PontoMensal.data_inicio <= data_fim,
            PontoMensal.data_fim >= data_inicio,
        )
        .order_by(PontoMensal.data_inicio)
    )
    registros = res.scalars().all()

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
