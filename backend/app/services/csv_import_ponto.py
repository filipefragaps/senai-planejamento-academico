"""
Importador da planilha de ponto batido (formato Excel, colunas A–P).
Colunas usadas (índice 0-based):
  B (1)  = Nome do Colaborador
  E (4)  = Mês  ex: "01/2026"  → data_inicio/data_fim calculados
  M (12) = Horas batidas no ponto  → horas_total (referência para regência real)
  N (13) = Banco de horas do mês   → horas_extras (positivo = saldo, negativo = déficit)
"""
import io
import re
import unicodedata
import calendar
import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_

from app.models.ponto import PontoMensal
from app.models.professor import Professor


# ── helpers ──────────────────────────────────────────────────────────────────

def _norm_nome(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper().strip())


def _cell_str(cell) -> str:
    """Valor da célula como string limpa (sem apóstrofo, sem espaços)."""
    if cell is None or cell.value is None:
        return ""
    return str(cell.value).strip().lstrip("'").strip()


def _parse_mes(val: str) -> tuple[datetime.date, datetime.date] | None:
    """'MM/YYYY' → (primeiro dia do mês, último dia do mês)."""
    m = re.match(r"^(\d{1,2})/(\d{4})$", val.strip())
    if not m:
        return None
    mes, ano = int(m.group(1)), int(m.group(2))
    if not (1 <= mes <= 12):
        return None
    ultimo = calendar.monthrange(ano, mes)[1]
    return datetime.date(ano, mes, 1), datetime.date(ano, mes, ultimo)


def _parse_horas(cell) -> float | None:
    """
    Converte célula Excel de horas para float.
    Suporta timedelta, datetime.time, float (fração de dia), string HH:MM ou -HH:MM.
    """
    if cell is None or cell.value is None:
        return None
    v = cell.value

    # openpyxl retorna elapsed-time como timedelta
    if isinstance(v, datetime.timedelta):
        return v.total_seconds() / 3600.0

    # datetime.time (para valores < 24h sem formato elapsed)
    if isinstance(v, datetime.time):
        return v.hour + v.minute / 60.0 + v.second / 3600.0

    # Número (fração de dia, pode ser negativo para banco de horas)
    if isinstance(v, (int, float)):
        return float(v) * 24.0

    # String
    s = str(v).strip().lstrip("'").strip()
    if not s or s == "-":
        return None
    # Suporta "-01:30" ou "109:10"
    m = re.match(r"^(-?)(\d+):(\d{2})(?::\d{2})?$", s)
    if m:
        h = int(m.group(2)) + int(m.group(3)) / 60.0
        return -h if m.group(1) == "-" else h
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


# ── importador principal ──────────────────────────────────────────────────────

async def importar_ponto(conteudo: bytes, db: AsyncSession) -> dict:
    """
    Lê o Excel, vincula colaboradores a professores (match normalizado).
    Substitui registros dos meses presentes no arquivo.
    """
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(conteudo), data_only=True)
        ws = wb.active
    except Exception as exc:
        raise ValueError(f"Não foi possível abrir o arquivo Excel: {exc}")

    # Pré-carregar professores
    res_prof = await db.execute(select(Professor.id, Professor.nome))
    prof_rows = res_prof.all()
    prof_map: dict[str, int] = {n.strip().upper(): pid for pid, n in prof_rows}
    prof_map_norm: dict[str, int] = {_norm_nome(n): pid for pid, n in prof_rows}

    periodos: set[tuple[datetime.date, datetime.date]] = set()
    parsed_rows: list[tuple] = []
    erros = 0

    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):  # pula cabeçalho
        # Garante que a linha tem colunas suficientes
        if len(row) < 14:
            continue

        nome = _cell_str(row[1])    # coluna B (índice 1)
        mes_str = _cell_str(row[4]) # coluna E (índice 4)

        if not nome or not mes_str:
            continue

        periodo = _parse_mes(mes_str)
        if not periodo:
            erros += 1
            continue

        horas_total  = _parse_horas(row[12])  # coluna M (índice 12)
        banco_horas  = _parse_horas(row[13])  # coluna N (índice 13)

        periodos.add(periodo)
        parsed_rows.append((nome, periodo[0], periodo[1], horas_total, banco_horas))

    # Remove registros dos meses que serão reimportados
    for di, df in periodos:
        await db.execute(
            delete(PontoMensal).where(
                and_(PontoMensal.data_inicio == di, PontoMensal.data_fim == df)
            )
        )

    inseridos = 0
    for nome, di, df, ht, hx in parsed_rows:
        professor_id = prof_map.get(nome.upper()) or prof_map_norm.get(_norm_nome(nome))
        db.add(PontoMensal(
            nome_colaborador=nome,
            data_inicio=di,
            data_fim=df,
            horas_efetivas=None,   # não disponível neste formato
            horas_extras=hx,       # banco de horas (pode ser negativo)
            horas_total=ht,        # horas batidas — referência para regência
            professor_id=professor_id,
        ))
        inseridos += 1

    await db.flush()
    return {"inseridos": inseridos, "erros": erros, "periodos": len(periodos)}
