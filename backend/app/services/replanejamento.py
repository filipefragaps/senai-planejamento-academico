"""
Serviço de Replanejamento Inteligente.
Quando coordenador altera uma aula, recalcula automaticamente as aulas futuras.
"""
from datetime import date, time, datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update as sql_update
from app.models.aula import Aula
from app.models.evento import Evento
from app.models.professor import Professor
from app.models.versao import VersaoCronograma
from app.algorithms.constraint_solver import (
    verificar_conflito_professor,
    verificar_conflito_sala,
    verificar_disponibilidade_professor,
    encontrar_professor_alternativo,
    get_datas_letivas,
)


def _snapshot_aula(aula: Aula, professor_nome: str | None = None) -> dict:
    return {
        "id": aula.id,
        "data": aula.data.isoformat() if aula.data else None,
        "horario_inicio": str(aula.horario_inicio),
        "horario_fim": str(aula.horario_fim),
        "professor_id": aula.professor_id,
        "professor_nome": professor_nome,
        "sala": aula.sala,
        "ambiente": aula.ambiente,
        "status": aula.status,
        "observacoes": aula.observacoes,
    }


async def registrar_versao(
    db: AsyncSession,
    aula_id: int | None,
    evento_id: int | None,
    tipo: str,
    antes: dict | None,
    depois: dict | None,
    motivo: str | None,
    usuario_id: int | None,
):
    versao = VersaoCronograma(
        aula_id=aula_id,
        evento_id=evento_id,
        tipo_alteracao=tipo,
        dados_antes=antes,
        dados_depois=depois,
        motivo=motivo,
        usuario_id=usuario_id,
    )
    db.add(versao)


async def alterar_aula_e_replaneja(
    aula_id: int,
    alteracoes: dict,
    replaneja_futuras: bool,
    motivo: str | None,
    usuario_id: int | None,
    db: AsyncSession,
) -> dict:
    """
    Altera uma aula e, opcionalmente, recalcula as aulas futuras.
    Mantém o mesmo professor a menos que haja conflito.
    """
    result = await db.execute(select(Aula).where(Aula.id == aula_id))
    aula = result.scalar_one_or_none()
    if not aula:
        raise ValueError(f"Aula {aula_id} não encontrada")

    result_ev = await db.execute(select(Evento).where(Evento.id == aula.evento_id))
    evento = result_ev.scalar_one_or_none()

    # Resolve nome do professor atual
    async def _nome_professor(prof_id: int | None) -> str | None:
        if not prof_id:
            return None
        r = await db.execute(select(Professor.nome).where(Professor.id == prof_id))
        return r.scalar_one_or_none()

    nome_prof_antes = await _nome_professor(aula.professor_id)
    snapshot_antes = _snapshot_aula(aula, nome_prof_antes)

    # Aplica alterações
    for campo, valor in alteracoes.items():
        if campo != "motivo" and hasattr(aula, campo):
            setattr(aula, campo, valor)

    aula.alterada_manualmente = True
    aula.dados_anteriores = snapshot_antes
    nome_prof_depois = await _nome_professor(aula.professor_id)
    snapshot_depois = _snapshot_aula(aula, nome_prof_depois)

    await registrar_versao(db, aula.id, evento.id if evento else None, "edicao", snapshot_antes, snapshot_depois, motivo, usuario_id)

    aulas_replanejadas = []
    conflitos = []

    if replaneja_futuras and evento:
        # Filtros base: aulas futuras (após a data editada) da mesma UC (se definida),
        # excluindo apenas Cancelada e Remarcada (Realizada é incluída — aulas passadas
        # marcadas pelo startup devem ser atualizadas pelo coordenador)
        filtros_base = [
            Aula.evento_id == evento.id,
            Aula.data > aula.data,
            ~Aula.status.in_(["Cancelada", "Remarcada"]),
        ]
        if aula.unidade_curricular_id is not None:
            filtros_base.append(Aula.unidade_curricular_id == aula.unidade_curricular_id)

        novo_professor_id = alteracoes.get("professor_id")
        nova_sala = alteracoes.get("sala")

        # UPDATE direto no banco — evita inconsistências de rastreamento de objetos
        # na sessão async do SQLAlchemy ao modificar muitos objetos em loop
        valores: dict = {}
        if novo_professor_id is not None:
            valores["professor_id"] = novo_professor_id
        if nova_sala:
            valores["sala"] = nova_sala

        if valores:
            await db.execute(
                sql_update(Aula)
                .where(and_(*filtros_base))
                .values(**valores)
                .execution_options(synchronize_session=False)
            )

        # Busca aulas para response e detecção de conflitos
        result_futuras = await db.execute(
            select(Aula).where(and_(*filtros_base)).order_by(Aula.data)
        )
        aulas_replanejadas = result_futuras.scalars().all()

        if novo_professor_id:
            for af in aulas_replanejadas:
                if await verificar_conflito_professor(
                    novo_professor_id, af.data, af.horario_inicio, af.horario_fim, db, af.id
                ):
                    conflitos.append({
                        "aula_id": af.id,
                        "data": af.data.isoformat(),
                        "motivo": "Professor com conflito de horário nesta data",
                    })

    return {
        "aula_alterada": aula,
        "aulas_replanejadas": aulas_replanejadas,
        "conflitos_detectados": conflitos,
    }


async def comparar_versoes(
    evento_id: int,
    versao_antes_id: int,
    versao_depois_id: int,
    db: AsyncSession,
) -> dict:
    """Compara duas versões do cronograma para um evento."""
    result = await db.execute(
        select(VersaoCronograma).where(
            and_(
                VersaoCronograma.evento_id == evento_id,
                VersaoCronograma.id >= versao_antes_id,
                VersaoCronograma.id <= versao_depois_id,
            )
        ).order_by(VersaoCronograma.id)
    )
    versoes = result.scalars().all()

    alteracoes = []
    for v in versoes:
        alteracoes.append({
            "id": v.id,
            "tipo": v.tipo_alteracao,
            "antes": v.dados_antes,
            "depois": v.dados_depois,
            "motivo": v.motivo,
            "criado_em": v.criado_em.isoformat(),
        })

    return {"evento_id": evento_id, "alteracoes": alteracoes, "total": len(alteracoes)}
