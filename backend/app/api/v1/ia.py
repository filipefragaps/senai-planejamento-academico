from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.ia_service import ia_service
from app.core.deps import get_current_user
from app.config import settings

router = APIRouter(prefix="/ia", tags=["Inteligência Artificial"])


class PerguntaRequest(BaseModel):
    pergunta: str | None = None


def _check_key():
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY não configurada. Adicione a chave no arquivo .env do backend e reinicie o servidor.",
        )


@router.get("/status")
async def status(_=Depends(get_current_user)):
    """Verifica se a API de IA está configurada."""
    return {"configurada": bool(settings.ANTHROPIC_API_KEY)}


@router.post("/analisar")
async def analisar_cronograma(
    body: PerguntaRequest = PerguntaRequest(),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    _check_key()
    try:
        resposta = await ia_service.analisar_cronograma(db, body.pergunta)
        return {"analise": resposta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na análise de IA: {str(e)}")


@router.post("/alternativas/{aula_id}")
async def sugerir_alternativa(
    aula_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    _check_key()

    from sqlalchemy import select
    from app.models.aula import Aula
    from app.models.evento import Evento
    from app.algorithms.constraint_solver import encontrar_professor_alternativo

    result = await db.execute(select(Aula).where(Aula.id == aula_id))
    aula = result.scalar_one_or_none()
    if not aula:
        raise HTTPException(status_code=404, detail="Aula não encontrada")

    result_ev = await db.execute(select(Evento).where(Evento.id == aula.evento_id))
    evento = result_ev.scalar_one_or_none()

    alternativas = await encontrar_professor_alternativo(evento, aula.data, aula.horario_inicio, aula.horario_fim, db)
    sugestao = await ia_service.sugerir_professor_alternativo(evento.id, aula.data, alternativas, db)

    return {"aula_id": aula_id, "alternativas": alternativas, "sugestao_ia": sugestao}


@router.get("/relatorio")
async def gerar_relatorio(
    tipo: str = "mensal",
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    _check_key()
    try:
        relatorio = await ia_service.gerar_relatorio_executivo(db, tipo)
        return {"relatorio": relatorio, "tipo": tipo}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar relatório: {str(e)}")
