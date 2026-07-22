from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc
from app.database import get_db
from app.models.versao import VersaoCronograma
from app.models.aula import Aula
from app.models.evento import Evento
from app.models.usuario import Usuario
from app.services.replanejamento import comparar_versoes
from app.core.deps import get_current_user

router = APIRouter(prefix="/versoes", tags=["Versões / Histórico"])


def _fmt(v: VersaoCronograma, aula: Aula | None, evento: Evento | None, usuario: Usuario | None) -> dict:
    return {
        "id": v.id,
        "tipo": v.tipo_alteracao,
        "antes": v.dados_antes,
        "depois": v.dados_depois,
        "motivo": v.motivo,
        "usuario_id": v.usuario_id,
        "usuario_nome": usuario.nome if usuario else None,
        "aula_id": v.aula_id,
        "aula_data": aula.data.isoformat() if aula and aula.data else None,
        "aula_horario_inicio": str(aula.horario_inicio) if aula else None,
        "aula_horario_fim": str(aula.horario_fim) if aula else None,
        "evento_id": v.evento_id,
        "nome_evento": evento.nome_turma if evento else None,
        "criado_em": v.criado_em.isoformat(),
    }


async def _enriquecer(versoes: list[VersaoCronograma], db: AsyncSession) -> list[dict]:
    # Coleta IDs únicos para buscar em lote
    aula_ids = {v.aula_id for v in versoes if v.aula_id}
    evento_ids = {v.evento_id for v in versoes if v.evento_id}
    usuario_ids = {v.usuario_id for v in versoes if v.usuario_id}

    aulas: dict[int, Aula] = {}
    if aula_ids:
        r = await db.execute(select(Aula).where(Aula.id.in_(aula_ids)))
        aulas = {a.id: a for a in r.scalars().all()}

    eventos: dict[int, Evento] = {}
    if evento_ids:
        r = await db.execute(select(Evento).where(Evento.id.in_(evento_ids)))
        eventos = {e.id: e for e in r.scalars().all()}

    usuarios: dict[int, Usuario] = {}
    if usuario_ids:
        r = await db.execute(select(Usuario).where(Usuario.id.in_(usuario_ids)))
        usuarios = {u.id: u for u in r.scalars().all()}

    return [
        _fmt(v, aulas.get(v.aula_id), eventos.get(v.evento_id), usuarios.get(v.usuario_id))
        for v in versoes
    ]


@router.get("/evento/{evento_id}")
async def historico_evento(
    evento_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Histórico de alterações de um evento, ordenado do mais recente."""
    result = await db.execute(
        select(VersaoCronograma)
        .where(VersaoCronograma.evento_id == evento_id)
        .order_by(desc(VersaoCronograma.criado_em))
        .offset(skip)
        .limit(limit)
    )
    return await _enriquecer(result.scalars().all(), db)


@router.get("/recentes")
async def historico_recentes(
    evento_id: int | None = Query(None),
    tipo: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Todas as alterações recentes, opcionalmente filtradas por evento e tipo."""
    filters = []
    if evento_id:
        filters.append(VersaoCronograma.evento_id == evento_id)
    if tipo:
        filters.append(VersaoCronograma.tipo_alteracao == tipo)

    query = select(VersaoCronograma).order_by(desc(VersaoCronograma.criado_em)).offset(skip).limit(limit)
    if filters:
        query = query.where(and_(*filters))

    result = await db.execute(query)
    return await _enriquecer(result.scalars().all(), db)


@router.get("/comparar/{evento_id}")
async def comparar(
    evento_id: int,
    versao_antes_id: int,
    versao_depois_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await comparar_versoes(evento_id, versao_antes_id, versao_depois_id, db)


@router.get("/aula/{aula_id}")
async def historico_aula(
    aula_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(VersaoCronograma)
        .where(VersaoCronograma.aula_id == aula_id)
        .order_by(VersaoCronograma.criado_em)
    )
    return await _enriquecer(result.scalars().all(), db)
