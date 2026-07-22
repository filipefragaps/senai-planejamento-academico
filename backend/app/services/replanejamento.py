"""
Serviço de Replanejamento Inteligente.
Quando coordenador altera uma aula, recalcula automaticamente as aulas futuras.
"""
from datetime import date, time, datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
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
        result_futuras = await db.execute(
            select(Aula).where(
                and_(
                    Aula.evento_id == evento.id,
                    Aula.data > aula.data,
                    Aula.status == "Agendada",
                    Aula.alterada_manualmente == False,
                )
            ).order_by(Aula.data)
        )
        aulas_futuras = result_futuras.scalars().all()

        for aula_futura in aulas_futuras:
            snap_antes = _snapshot_aula(aula_futura)

            # Mantém professor atual do evento (pode ter mudado)
            professor_id = evento.professor_id
            if professor_id and aula_futura.professor_id != professor_id:
                # Verifica se novo professor tem conflito
                if not await verificar_conflito_professor(
                    professor_id, aula_futura.data, aula_futura.horario_inicio, aula_futura.horario_fim, db, aula_futura.id
                ):
                    aula_futura.professor_id = professor_id

            # Se professor mudou na aula atual, propaga
            novo_professor_id = alteracoes.get("professor_id")
            if novo_professor_id and novo_professor_id != aula_futura.professor_id:
                if not await verificar_conflito_professor(
                    novo_professor_id, aula_futura.data, aula_futura.horario_inicio, aula_futura.horario_fim, db, aula_futura.id
                ):
                    if await verificar_disponibilidade_professor(
                        novo_professor_id, aula_futura.data.weekday(),
                        aula_futura.horario_inicio, aula_futura.horario_fim, db
                    ):
                        aula_futura.professor_id = novo_professor_id
                    else:
                        alternativas = await encontrar_professor_alternativo(
                            evento, aula_futura.data, aula_futura.horario_inicio, aula_futura.horario_fim, db
                        )
                        if alternativas:
                            aula_futura.professor_id = alternativas[0]["professor_id"]
                        else:
                            conflitos.append({
                                "aula_id": aula_futura.id,
                                "data": aula_futura.data.isoformat(),
                                "motivo": "Nenhum professor alternativo disponível",
                            })

            # Propaga sala se alterada
            nova_sala = alteracoes.get("sala")
            if nova_sala and nova_sala != aula_futura.sala:
                if not await verificar_conflito_sala(
                    nova_sala, aula_futura.data, aula_futura.horario_inicio, aula_futura.horario_fim, db, aula_futura.id
                ):
                    aula_futura.sala = nova_sala

            snap_depois = _snapshot_aula(aula_futura)
            if snap_antes != snap_depois:
                await registrar_versao(db, aula_futura.id, evento.id, "replanejamento", snap_antes, snap_depois, "Replanejamento automático", usuario_id)
                aulas_replanejadas.append(aula_futura)

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
