"""Celery tasks for async operations (schedule generation, report generation)."""
import asyncio
from app.celery_app import celery_app


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="gerar_aulas_evento")
def task_gerar_aulas_evento(self, evento_id: int):
    async def _run():
        from app.database import AsyncSessionLocal
        from app.models.evento import Evento
        from app.algorithms.constraint_solver import gerar_aulas_evento
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Evento).where(Evento.id == evento_id))
            evento = result.scalar_one_or_none()
            if not evento:
                return {"erro": "Evento não encontrado"}
            aulas, conflitos = await gerar_aulas_evento(evento, db)
            await db.commit()
            return {"aulas_geradas": len(aulas), "conflitos": len(conflitos)}

    return run_async(_run())


@celery_app.task(bind=True, name="gerar_relatorio_ia")
def task_gerar_relatorio_ia(self, tipo: str = "mensal"):
    async def _run():
        from app.database import AsyncSessionLocal
        from app.services.ia_service import ia_service

        async with AsyncSessionLocal() as db:
            return await ia_service.gerar_relatorio_ia(db, tipo)

    return run_async(_run())
