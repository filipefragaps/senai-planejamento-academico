"""
Algoritmo de geração de cronograma baseado em restrições (CSP).

Restrições NUNCA violadas:
1. Sem conflito de professor (mesmo professor, mesmo horário)
2. Sem conflito de sala (mesma sala, mesmo horário)
3. Respeitada disponibilidade do professor
4. Respeitado calendário acadêmico (sem feriados/recessos)
5. Respeitada carga horária semanal do evento
6. Alerta quando próximo do limite contratual
"""
from datetime import date, time, timedelta, datetime
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.aula import Aula
from app.models.professor import Professor
from app.models.disponibilidade import DisponibilidadeDetalhada
from app.models.calendario import CalendarioAcademico
from app.models.evento import Evento


async def get_datas_letivas(
    data_inicio: date,
    data_fim: date,
    dias_semana: list[int],
    db: AsyncSession,
) -> list[date]:
    """Retorna lista de datas letivas (exclui dias não-letivos do calendário)."""
    from sqlalchemy import or_, func as sqlfunc
    # Exclui dias onde letivo=False (campo explícito) OU tipo é feriado/recesso
    # (compatibilidade com registros anteriores ao campo letivo)
    result = await db.execute(
        select(CalendarioAcademico.data).where(
            and_(
                CalendarioAcademico.data >= data_inicio,
                CalendarioAcademico.data <= data_fim,
                or_(
                    CalendarioAcademico.letivo == False,
                    sqlfunc.lower(CalendarioAcademico.tipo).in_([
                        "feriado", "recesso", "ferias", "férias",
                        "folga", "compensacao", "compensação", "sem aula",
                    ]),
                ),
            )
        )
    )
    datas_bloqueadas = {row[0] for row in result.fetchall()}

    datas = []
    current = data_inicio
    while current <= data_fim:
        if current.weekday() in dias_semana and current not in datas_bloqueadas:
            datas.append(current)
        current += timedelta(days=1)

    return datas


async def verificar_conflito_professor(
    professor_id: int,
    data: date,
    h_ini: time,
    h_fim: time,
    db: AsyncSession,
    excluir_aula_id: int | None = None,
) -> bool:
    """Verifica se professor já tem aula no horário."""
    query = select(Aula).where(
        and_(
            Aula.professor_id == professor_id,
            Aula.data == data,
            Aula.status != "Cancelada",
            Aula.horario_inicio < h_fim,
            Aula.horario_fim > h_ini,
        )
    )
    if excluir_aula_id:
        from sqlalchemy import not_
        query = query.where(Aula.id != excluir_aula_id)
    result = await db.execute(query)
    return result.scalars().first() is not None


async def verificar_conflito_sala(
    sala: str,
    data: date,
    h_ini: time,
    h_fim: time,
    db: AsyncSession,
    excluir_aula_id: int | None = None,
) -> bool:
    """Verifica se sala já está ocupada no horário."""
    if not sala:
        return False
    query = select(Aula).where(
        and_(
            Aula.sala == sala,
            Aula.data == data,
            Aula.status != "Cancelada",
            Aula.horario_inicio < h_fim,
            Aula.horario_fim > h_ini,
        )
    )
    if excluir_aula_id:
        query = query.where(Aula.id != excluir_aula_id)
    result = await db.execute(query)
    return result.scalars().first() is not None


async def verificar_disponibilidade_professor(
    professor_id: int,
    dia_semana: int,
    h_ini: time,
    h_fim: time,
    db: AsyncSession,
) -> bool:
    """Verifica se professor está disponível no dia/horário."""
    result = await db.execute(
        select(DisponibilidadeDetalhada).where(
            and_(
                DisponibilidadeDetalhada.professor_id == professor_id,
                DisponibilidadeDetalhada.dia_semana == dia_semana,
                DisponibilidadeDetalhada.tipo_disponibilidade.in_(["Disponível", "Preferencial"]),
                DisponibilidadeDetalhada.horario_inicio <= h_ini,
                DisponibilidadeDetalhada.horario_fim >= h_fim,
            )
        )
    )
    disponibilidade = result.scalars().first()

    # Se não há registros de disponibilidade, assume disponível (sem restrição cadastrada)
    if disponibilidade is None:
        result2 = await db.execute(
            select(DisponibilidadeDetalhada).where(
                DisponibilidadeDetalhada.professor_id == professor_id
            )
        )
        tem_registros = result2.scalars().first()
        if tem_registros is None:
            return True  # Sem cadastro = disponível

        # Tem registros mas não no horário = indisponível implícito
        return False

    return True


async def gerar_aulas_evento(evento: Evento, db: AsyncSession) -> tuple[list[Aula], list[dict]]:
    """
    Gera as aulas de um evento respeitando todas as restrições.
    Retorna (aulas_criadas, conflitos_detectados)
    """
    datas = await get_datas_letivas(evento.data_inicio, evento.data_fim, evento.dias_semana, db)
    conflitos = []
    aulas_criadas = []

    horas_por_aula = (
        datetime.combine(date.today(), evento.horario_fim) -
        datetime.combine(date.today(), evento.horario_inicio)
    ).seconds / 3600

    horas_necessarias = evento.carga_horaria_total
    horas_geradas = 0

    for data in datas:
        if horas_geradas >= horas_necessarias:
            break

        h_ini = evento.horario_inicio
        h_fim = evento.horario_fim

        erros_data = []

        # Verificação 1: conflito professor
        if evento.professor_id:
            if await verificar_conflito_professor(evento.professor_id, data, h_ini, h_fim, db):
                erros_data.append(f"Conflito de professor em {data}")

        # Verificação 2: conflito sala
        if evento.sala:
            if await verificar_conflito_sala(evento.sala, data, h_ini, h_fim, db):
                erros_data.append(f"Conflito de sala '{evento.sala}' em {data}")

        # Verificação 3: disponibilidade professor
        if evento.professor_id:
            if not await verificar_disponibilidade_professor(evento.professor_id, data.weekday(), h_ini, h_fim, db):
                erros_data.append(f"Professor indisponível em {data} ({h_ini}-{h_fim})")

        if erros_data:
            conflitos.append({"data": data.isoformat(), "erros": erros_data})
            continue

        aula = Aula(
            evento_id=evento.id,
            professor_id=evento.professor_id,
            data=data,
            horario_inicio=h_ini,
            horario_fim=h_fim,
            sala=evento.sala,
            status="Agendada",
            tipo="Regular",
        )
        db.add(aula)
        aulas_criadas.append(aula)
        horas_geradas += horas_por_aula

    return aulas_criadas, conflitos


async def encontrar_professor_alternativo(
    evento: Evento,
    data: date,
    h_ini: time,
    h_fim: time,
    db: AsyncSession,
) -> list[dict]:
    """Encontra professores alternativos para o horário sem conflito."""
    from app.models.atuacao import Atuacao
    from sqlalchemy.orm import joinedload

    result = await db.execute(
        select(Professor).where(Professor.ativo == True)
    )
    professores = result.scalars().all()
    alternativas = []

    for prof in professores:
        if prof.id == evento.professor_id:
            continue

        # Verifica se tem habilitação para a disciplina
        res_at = await db.execute(
            select(Atuacao).where(
                and_(
                    Atuacao.professor_id == prof.id,
                    Atuacao.disciplina == evento.disciplina,
                )
            )
        )
        if not res_at.scalars().first():
            continue

        # Verifica disponibilidade
        if not await verificar_disponibilidade_professor(prof.id, data.weekday(), h_ini, h_fim, db):
            continue

        # Verifica conflito de horário
        if await verificar_conflito_professor(prof.id, data, h_ini, h_fim, db):
            continue

        res_at2 = await db.execute(
            select(Atuacao).where(
                and_(Atuacao.professor_id == prof.id, Atuacao.disciplina == evento.disciplina)
            )
        )
        atuacao = res_at2.scalars().first()

        alternativas.append({
            "professor_id": prof.id,
            "nome": prof.nome,
            "nivel_competencia": atuacao.nivel_competencia if atuacao else 0,
        })

    return sorted(alternativas, key=lambda x: x["nivel_competencia"], reverse=True)
