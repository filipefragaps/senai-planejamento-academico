"""
Cálculo de Regência docente.
- Mensalistas: meta = 70% de (horas_contratadas/semana × semanas do período).
- Horistas:    CH contratada é o MÍNIMO semanal. Regência = min(100%, horas_realizadas / ch_minima_periodo).
               Se realizou acima do mínimo, regência permanece 100% e é gerada uma observação explicativa.
               Horistas NÃO têm sobrecarga — recebem por hora e podem fazer mais do que o mínimo.
"""
from datetime import date, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from app.models.professor import Professor
from app.models.aula import Aula
from app.models.atuacao import Atuacao

_TIPOS_QUADRO = {"Mensalista", "Horista", "Inclusão em Folha"}


def _horas_aula(aula: Aula) -> float:
    """Calcula duração de uma aula em horas (compatível SQLite e PostgreSQL)."""
    base = date.today()
    inicio = datetime.combine(base, aula.horario_inicio)
    fim = datetime.combine(base, aula.horario_fim)
    return (fim - inicio).seconds / 3600

META_REGENCIA_MENSALISTA = 0.70
ALERTA_INFERIOR = 0.50  # Abaixo disso = Crítico
ALERTA_SUPERIOR = 0.90  # Acima disso = Alerta de sobrecarga


_TIPOS_MENSALISTA = {"Mensalista", "Inclusão em Folha"}


def calcular_status_regencia(percentual: float, tipo: str) -> str:
    if tipo in _TIPOS_MENSALISTA:
        if percentual < ALERTA_INFERIOR:
            return "Critico"
        elif percentual < META_REGENCIA_MENSALISTA:
            return "Alerta"
        elif percentual > ALERTA_SUPERIOR:
            return "Sobrecarga"
        return "OK"
    else:
        # Horista: regência já vem capped em 1.0 (100%)
        # O status reflete cumprimento da CH mínima
        if percentual < ALERTA_INFERIOR:
            return "Critico"
        elif percentual < 1.0:
            return "Alerta"
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

    # Turmas juntas (ensalamento conjunto): mesmo professor, mesmo dia e horário em
    # eventos diferentes → conta o slot uma única vez para não duplicar a regência.
    slots_unicos: dict[tuple, Aula] = {}
    for a in aulas_lista:
        chave = (a.data, a.horario_inicio, a.horario_fim)
        if chave not in slots_unicos:
            slots_unicos[chave] = a
    horas_ministradas = sum(_horas_aula(a) for a in slots_unicos.values())

    semanas = max(1, (data_fim - data_inicio).days / 7)
    horas_excedentes = 0.0
    observacao = None

    if professor.tipo in _TIPOS_MENSALISTA:
        horas_periodo = professor.horas_contratadas * semanas
        percentual = horas_ministradas / horas_periodo if horas_periodo > 0 else 0
        meta = META_REGENCIA_MENSALISTA
        remuneracao = None
    else:
        # Horista: horas_contratadas = CH mínima semanal
        horas_periodo = professor.horas_contratadas * semanas
        horas_excedentes = max(0.0, horas_ministradas - horas_periodo)
        # Regência com teto em 100% — acima do mínimo não aumenta o indicador
        percentual = min(1.0, horas_ministradas / horas_periodo) if horas_periodo > 0 else 0
        meta = 1.0  # meta do Horista = cumprir 100% da CH mínima
        remuneracao = horas_ministradas * (professor.valor_hora or 0)
        if horas_excedentes > 0:
            observacao = (
                f"Realizou {round(horas_excedentes, 1)}h acima da CH mínima contratada "
                f"({professor.horas_contratadas}h/sem × {round(semanas, 1)} sem = {round(horas_periodo, 1)}h). "
                "Regência máxima atingida — horas excedentes são remuneradas normalmente."
            )

    # Modalidades distintas do professor (vindas das atuações já carregadas ou lazy)
    modalidades: list[str] = []
    try:
        for at in professor.atuacoes:
            m = (at.modalidade or "").strip()
            if m and m not in modalidades:
                modalidades.append(m)
    except Exception:
        pass  # atuacoes não carregadas — filtragem no frontend usará lista vazia

    return {
        "professor_id": professor.id,
        "nome": professor.nome,
        "tipo": professor.tipo,
        "quadro": professor.tipo in _TIPOS_QUADRO,
        "modalidades": modalidades,
        "horas_contratadas": professor.horas_contratadas,
        "horas_ministradas": round(horas_ministradas, 2),
        "horas_periodo": round(horas_periodo, 2),
        "horas_excedentes": round(horas_excedentes, 2),
        "percentual_regencia": round(percentual * 100, 2),
        "meta_regencia": round(meta * 100, 2),
        "status": calcular_status_regencia(percentual, professor.tipo),
        "remuneracao_horista": round(remuneracao, 2) if remuneracao is not None else None,
        "observacao": observacao,
        "periodo_inicio": data_inicio.isoformat(),
        "periodo_fim": data_fim.isoformat(),
    }


async def calcular_regencia_todos(
    db: AsyncSession,
    data_inicio: date | None = None,
    data_fim: date | None = None,
) -> list[dict]:
    result = await db.execute(
        select(Professor)
        .options(selectinload(Professor.atuacoes))
        .where(Professor.ativo == True)
    )
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
