"""
Cálculo de Regência docente.
- Mensalistas: meta = 70% = horas_ministradas / horas_contratadas (semanal)
- Horistas: cálculo de remuneração por horas ministradas
"""
from datetime import date, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.professor import Professor
from app.models.aula import Aula


def _horas_aula(aula: Aula) -> float:
    """Calcula duração de uma aula em horas (compatível SQLite e PostgreSQL)."""
    base = date.today()
    inicio = datetime.combine(base, aula.horario_inicio)
    fim = datetime.combine(base, aula.horario_fim)
    return (fim - inicio).seconds / 3600

META_REGENCIA_MENSALISTA = 0.70
ALERTA_INFERIOR = 0.50  # Abaixo disso = Crítico
ALERTA_SUPERIOR = 0.90  # Acima disso = Alerta de sobrecarga


def calcular_status_regencia(percentual: float, tipo: str) -> str:
    if tipo == "Mensalista":
        if percentual < ALERTA_INFERIOR:
            return "Critico"
        elif percentual < META_REGENCIA_MENSALISTA:
            return "Alerta"
        elif percentual > ALERTA_SUPERIOR:
            return "Sobrecarga"
        return "OK"
    else:  # Horista
        if percentual < ALERTA_INFERIOR:
            return "Baixa carga"
        elif percentual > ALERTA_SUPERIOR:
            return "Alta carga"
        return "OK"


async def calcular_regencia_professor(
    professor: Professor,
    db: AsyncSession,
    data_inicio: date | None = None,
    data_fim: date | None = None,
) -> dict:
    """Calcula regência de um professor em um período."""
    if data_inicio is None:
        # Default: semana atual (segunda a domingo)
        hoje = date.today()
        data_inicio = hoje - timedelta(days=hoje.weekday())
        data_fim = data_inicio + timedelta(days=6)

    filters = [
        Aula.professor_id == professor.id,
        Aula.status.in_(["Realizada", "Agendada"]),
        Aula.data >= data_inicio,
        Aula.data <= data_fim,
    ]

    result = await db.execute(select(Aula).where(and_(*filters)))
    aulas_lista = result.scalars().all()
    horas_ministradas = sum(_horas_aula(a) for a in aulas_lista)

    if professor.tipo == "Mensalista":
        # Horas semanais contratadas
        horas_semanais = professor.horas_contratadas
        # Ajustar para o período
        semanas = max(1, (data_fim - data_inicio).days / 7)
        horas_periodo = horas_semanais * semanas
        percentual = horas_ministradas / horas_periodo if horas_periodo > 0 else 0
        meta = META_REGENCIA_MENSALISTA
        remuneracao = None
    else:  # Horista
        horas_periodo = professor.horas_contratadas  # máximo contratado
        percentual = horas_ministradas / horas_periodo if horas_periodo > 0 else 0
        meta = None
        remuneracao = horas_ministradas * (professor.valor_hora or 0)

    return {
        "professor_id": professor.id,
        "nome": professor.nome,
        "tipo": professor.tipo,
        "horas_contratadas": professor.horas_contratadas,
        "horas_ministradas": horas_ministradas,
        "percentual_regencia": round(percentual * 100, 2),
        "meta_regencia": round((meta or 0) * 100, 2),
        "status": calcular_status_regencia(percentual, professor.tipo),
        "remuneracao_horista": round(remuneracao, 2) if remuneracao is not None else None,
        "periodo_inicio": data_inicio.isoformat(),
        "periodo_fim": data_fim.isoformat(),
    }


async def calcular_regencia_todos(
    db: AsyncSession,
    data_inicio: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    result = await db.execute(select(Professor).where(Professor.ativo == True))
    professores = result.scalars().all()

    resultados = []
    for prof in professores:
        reg = await calcular_regencia_professor(prof, db, data_inicio, data_fim)
        resultados.append(reg)

    return sorted(resultados, key=lambda x: x["percentual_regencia"])


async def verificar_limite_professor(
    professor_id: int,
    db: AsyncSession,
    data_inicio: date,
    data_fim: date,
    horas_novas: float,
) -> dict:
    """Verifica se adicionar horas excede o limite contratual."""
    result = await db.execute(select(Professor).where(Professor.id == professor_id))
    professor = result.scalar_one_or_none()
    if not professor:
        return {"ok": False, "motivo": "Professor não encontrado"}

    reg = await calcular_regencia_professor(professor, db, data_inicio, data_fim)
    horas_atuais = reg["horas_ministradas"]
    semanas = max(1, (data_fim - data_inicio).days / 7)
    horas_limite = professor.horas_contratadas * semanas

    if horas_atuais + horas_novas > horas_limite * ALERTA_SUPERIOR:
        return {
            "ok": False,
            "alerta": True,
            "motivo": f"Professor {professor.nome} ficará com {round((horas_atuais + horas_novas) / horas_limite * 100, 1)}% de carga (acima de {ALERTA_SUPERIOR*100}%)",
            "horas_disponiveis": round(horas_limite - horas_atuais, 1),
        }
    return {"ok": True, "horas_disponiveis": round(horas_limite - horas_atuais, 1)}
