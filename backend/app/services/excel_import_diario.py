"""
Importador da planilha de diário de aulas ministradas.
Colunas esperadas:
  INSTRUTOR | EVENTO - CURSO | COMPONENTE | DIA | HORA INICIO | HORA TÉRMINO | QTDE. HORAS | AMBIENTE | CONTEÚDO MINISTRADO
"""
import re
import unicodedata
from datetime import date, time, datetime

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.diario import DiarioAula
from app.models.professor import Professor
from app.models.aula import Aula
from app.models.evento import Evento


def _norm_col(col: str) -> str:
    col = str(col).lower().strip()
    col = unicodedata.normalize("NFD", col)
    col = "".join(c for c in col if unicodedata.category(c) != "Mn")
    col = re.sub(r"[^a-z0-9]+", "_", col)
    return col.strip("_")


def _get(row: pd.Series, *keys: str) -> str:
    for k in keys:
        v = row.get(k, "")
        if v != "" and not (isinstance(v, float) and pd.isna(v)):
            return str(v).strip()
    return ""


def _parse_date(val) -> date | None:
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, (datetime, pd.Timestamp)):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()[:10]
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_time(val) -> time | None:
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, time):
        return val
    if isinstance(val, datetime):
        return val.time()
    s = str(val).strip()
    for fmt in ("%H:%M:%S", "%H:%M", "%H%M"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    return None


def _parse_float(val) -> float | None:
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return float(str(val).replace(",", "."))
    except (ValueError, TypeError):
        return None


def _extrair_codigo(texto: str) -> tuple[str, str]:
    """
    De "1069274 - COSTUREIRO INDUSTRIAL - MALHA" extrai ("1069274", "COSTUREIRO INDUSTRIAL - MALHA").
    De "275614 - COSTUREIRO INDUSTRIAL - MALHA 160 HS" extrai ("275614", "COSTUREIRO INDUSTRIAL - MALHA 160 HS").
    """
    m = re.match(r"^(\d+)\s*[-–]\s*(.+)$", texto.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return "", texto.strip()


async def importar_diario(conteudo: bytes, db: AsyncSession) -> dict:
    """
    Lê o Excel, resolve vínculos com professores e aulas, substitui os registros anteriores.
    Retorna dict com contadores.
    """
    try:
        df = pd.read_excel(conteudo, dtype=str)
    except Exception as e:
        raise ValueError(f"Erro ao ler arquivo: {e}")

    df.columns = [_norm_col(c) for c in df.columns]
    df = df.fillna("")

    # Mapeia nomes de coluna normalizados para os esperados
    # (aceita variações: "hora_inicio", "hora_termino", "hora_termino", "qtde_horas", etc.)
    COL_INSTRUTOR   = next((c for c in df.columns if "instrutor" in c), None)
    COL_EVENTO      = next((c for c in df.columns if "evento" in c and "curso" in c), None) or \
                      next((c for c in df.columns if "evento" in c), None)
    COL_COMPONENTE  = next((c for c in df.columns if "componente" in c), None)
    COL_DIA         = next((c for c in df.columns if c in ("dia", "data")), None)
    COL_HI          = next((c for c in df.columns if "hora" in c and ("inicio" in c or "start" in c)), None) or \
                      next((c for c in df.columns if "hora_i" in c), None)
    COL_HF          = next((c for c in df.columns if "hora" in c and ("term" in c or "fim" in c or "end" in c)), None) or \
                      next((c for c in df.columns if "hora_t" in c), None)
    COL_HORAS       = next((c for c in df.columns if "qtde" in c or "horas" in c), None)
    COL_AMBIENTE    = next((c for c in df.columns if "ambiente" in c), None)
    COL_CONTEUDO    = next((c for c in df.columns if "conteudo" in c or "ministrado" in c), None)

    if not COL_INSTRUTOR:
        raise ValueError("Coluna INSTRUTOR não encontrada. Colunas detectadas: " + ", ".join(df.columns))
    if not COL_DIA:
        raise ValueError("Coluna DIA/DATA não encontrada.")

    # Pré-carregar professores (nome → id)
    res_prof = await db.execute(select(Professor.id, Professor.nome))
    prof_map: dict[str, int] = {nome.strip().upper(): pid for pid, nome in res_prof.all()}

    # Pré-carregar eventos (nome_turma → id) para match por codigo
    res_ev = await db.execute(select(Evento.id, Evento.nome_turma))
    evento_map: dict[str, int] = {}  # codigo → evento_id
    for ev_id, nome_turma in res_ev.all():
        if nome_turma:
            codigo = nome_turma.strip().split()[0]  # primeiro token é o código
            evento_map[codigo] = ev_id

    # Apagar registros anteriores
    await db.execute(delete(DiarioAula))

    inseridos = 0
    erros = 0

    for _, row in df.iterrows():
        instrutor = _get(row, COL_INSTRUTOR) if COL_INSTRUTOR else ""
        if not instrutor:
            continue

        evento_raw    = _get(row, COL_EVENTO)    if COL_EVENTO    else ""
        componente_raw = _get(row, COL_COMPONENTE) if COL_COMPONENTE else ""
        dia_raw        = _get(row, COL_DIA)       if COL_DIA       else ""
        hi_raw         = _get(row, COL_HI)        if COL_HI        else ""
        hf_raw         = _get(row, COL_HF)        if COL_HF        else ""
        horas_raw      = _get(row, COL_HORAS)     if COL_HORAS     else ""
        ambiente_raw   = _get(row, COL_AMBIENTE)  if COL_AMBIENTE  else ""
        conteudo_raw   = _get(row, COL_CONTEUDO)  if COL_CONTEUDO  else ""

        data = _parse_date(dia_raw)
        if not data:
            erros += 1
            continue

        ev_codigo, ev_nome     = _extrair_codigo(evento_raw)
        comp_codigo, comp_nome = _extrair_codigo(componente_raw)

        hora_inicio  = _parse_time(hi_raw)
        hora_termino = _parse_time(hf_raw)
        qtde_horas   = _parse_float(horas_raw)

        # Resolver professor_id por nome exato
        professor_id = prof_map.get(instrutor.upper())

        # Resolver aula_id: por professor_id + data + hora_inicio
        aula_id: int | None = None
        if professor_id and hora_inicio:
            res_aula = await db.execute(
                select(Aula.id).where(
                    Aula.professor_id == professor_id,
                    Aula.data == data,
                    Aula.horario_inicio == hora_inicio,
                ).limit(1)
            )
            aula_id = res_aula.scalar_one_or_none()

        db.add(DiarioAula(
            instrutor=instrutor,
            evento_codigo=ev_codigo or None,
            evento_nome=ev_nome or None,
            componente_codigo=comp_codigo or None,
            componente_nome=comp_nome or None,
            data=data,
            hora_inicio=hora_inicio,
            hora_termino=hora_termino,
            qtde_horas=qtde_horas,
            ambiente=ambiente_raw or None,
            conteudo=conteudo_raw or None,
            professor_id=professor_id,
            aula_id=aula_id,
        ))
        inseridos += 1

    await db.flush()
    return {"inseridos": inseridos, "erros": erros}
