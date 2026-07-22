"""
Importador da planilha de Eventos/Ofertas do SENAI.
Espera um arquivo Excel com abas "1° SEMESTRE" e/ou "2° SEMESTRE".
Colunas: MODALIDADE | ÁREA | PASTA | CURSO | EVENTO | TURNO | DIAS SEMANA |
         CIDADE | C.H | HORA INÍCIO | HORA TÉRMINO | DATA INÍCIO | DATA TÉRMINO |
         STATUS | VAGAS | MIN. PARA INÍCIO | PARCELAS BOLETO | VALOR IND. |
         PARCELA COM DESC. | TOTAL POR ALUNO | HORA AULA | ALUNOS MATRICULADOS
"""
import unicodedata
import re
from datetime import date, time, datetime

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.oferta import OfertaCurso
from app.models.curso import Curso


# ── helpers de normalização ────────────────────────────────────────────────────

def _norm_col(col: str) -> str:
    col = str(col).lower().strip()
    col = unicodedata.normalize("NFD", col)
    col = "".join(c for c in col if unicodedata.category(c) != "Mn")
    col = re.sub(r"[^a-z0-9]+", "_", col)
    return col.strip("_")


def _norm_df(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [_norm_col(c) for c in df.columns]
    return df.fillna("")


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
    # Pega só os primeiros 10 chars — descarta hora em "2026-10-05 00:00:00"
    s = str(val).strip()[:10]
    # Tenta formatos explícitos em ordem: brasileiro (dd/mm/yyyy) primeiro,
    # depois ISO (yyyy-mm-dd). Evita o bug do pandas onde dayfirst=True é
    # ignorado em datas ambíguas (primeiro número ≤ 12).
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        return pd.to_datetime(val, dayfirst=True).date()
    except Exception:
        return None


def _parse_time(val) -> time | None:
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, datetime):
        return val.time().replace(second=0, microsecond=0)
    if isinstance(val, time):
        return val.replace(second=0, microsecond=0)
    if isinstance(val, float):
        # Excel armazena hora como fração do dia
        total_min = round(val * 1440)
        h, m = divmod(total_min, 60)
        return time(h % 24, m)
    try:
        s = str(val).strip()[:5]
        return datetime.strptime(s, "%H:%M").time()
    except Exception:
        return None


def _parse_int(val, default: int = 0) -> int:
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return default
    try:
        return int(float(str(val).replace(",", ".")))
    except Exception:
        return default


def _parse_float(val) -> float | None:
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        cleaned = re.sub(r"[R$\s]", "", str(val)).replace(",", ".")
        return float(cleaned)
    except Exception:
        return None


def _norm_status(val: str) -> str:
    """Normaliza variações de status para valores canônicos."""
    upper = val.upper().strip()
    if "MATR" in upper:
        return "EM MATRÍCULA"
    if "CANCEL" in upper:
        return "CANCELADO"
    if "INICIO" in upper or "INICIOU" in upper or "INICIA" in upper:
        return "INICIOU"
    if "PLANO" in upper or "PLAN" in upper:
        return "PLANEJADO"
    return val.strip() if val.strip() else "NÃO DEFINIDO"


# ── serviço principal ──────────────────────────────────────────────────────────

async def importar_ofertas(conteudo: bytes, db: AsyncSession) -> dict:
    xls = pd.ExcelFile(conteudo)
    total_inseridos = 0
    total_atualizados = 0

    # Detecta abas de semestre
    for sheet in xls.sheet_names:
        norm = _norm_col(sheet)
        if "semestre" not in norm and "1_sem" not in norm and "2_sem" not in norm:
            continue
        semestre = 2 if "2" in norm else 1
        resultado = await _processar_sheet(xls, sheet, semestre, db)
        total_inseridos += resultado["inseridos"]
        total_atualizados += resultado["atualizados"]

    return {"inseridos": total_inseridos, "atualizados": total_atualizados}


async def _processar_sheet(
    xls: pd.ExcelFile, sheet: str, semestre: int, db: AsyncSession
) -> dict:
    df = _norm_df(pd.read_excel(xls, sheet_name=sheet, dtype=str))

    # Cache PASTA → curso_id
    cache_curso: dict[str, int | None] = {}
    # Rastreia códigos já processados nesta aba para evitar duplicatas internas
    vistos: set[str] = set()
    inseridos = 0
    atualizados = 0

    for _, row in df.iterrows():
        codigo_evento = _get(row, "evento")
        nome_curso = _get(row, "curso")
        if not codigo_evento or not nome_curso:
            continue

        # Pula duplicatas dentro da mesma aba
        if codigo_evento in vistos:
            continue
        vistos.add(codigo_evento)

        # Resolve curso_id pela PASTA
        pasta = _get(row, "pasta")
        if pasta not in cache_curso:
            res = await db.execute(select(Curso).where(Curso.codigo == pasta))
            c = res.scalar_one_or_none()
            cache_curso[pasta] = c.id if c else None
        curso_id = cache_curso[pasta]

        # Campos com nomes de coluna variados após normalização
        ch = _parse_int(_get(row, "c_h", "ch", "carga_horaria", "carga_h"), 0)
        hora_ini = _parse_time(row.get("hora_inicio", row.get("hora_inic", "")))
        hora_fim = _parse_time(row.get("hora_termino", row.get("hora_term", "")))
        d_ini = _parse_date(row.get("data_inicio", row.get("data_inic", "")))
        d_fim = _parse_date(row.get("data_termino", row.get("data_term", "")))

        # Campos extras: PREVISÃO DE INÍCIO → previsao_inicio, EXECUÇÃO → execucao,
        # STATUS DO CRONOGRAMA → status_cronograma
        previsao = _get(row, "previsao_de_inicio", "previsao_inicio", "previsao") or None
        execucao = _get(row, "execucao") or None
        status_cron = _get(row, "status_do_cronograma", "status_cronograma") or None

        dados = dict(
            semestre=semestre,
            modalidade=_get(row, "modalidade") or "NÃO DEFINIDO",
            area=_get(row, "area") or None,
            pasta=pasta or None,
            curso_id=curso_id,
            nome_curso=nome_curso,
            turno=_get(row, "turno") or None,
            dias_semana_texto=_get(row, "dias_semana") or None,
            cidade=_get(row, "cidade") or None,
            carga_horaria=ch,
            hora_inicio=hora_ini,
            hora_termino=hora_fim,
            data_inicio=d_ini,
            data_termino=d_fim,
            status=_norm_status(_get(row, "status")),
            vagas=_parse_int(_get(row, "vagas")),
            min_para_inicio=_parse_int(_get(row, "min_para_inicio")),
            parcelas_boleto=_parse_int(_get(row, "parcelas_boleto")) or None,
            valor_individual=_parse_float(_get(row, "valor_ind", "valor_individual")),
            parcela_com_desconto=_parse_float(_get(row, "parcela_com_desc", "parcela_com_desconto")),
            total_por_aluno=_parse_float(_get(row, "total_por_aluno")),
            hora_aula=_parse_int(_get(row, "hora_aula")) or None,
            alunos_matriculados=_parse_int(_get(row, "alunos_matriculados", "alunos_matr")),
            previsao_inicio=previsao,
            execucao=execucao,
            status_cronograma=status_cron,
        )

        # Upsert: SELECT antes do INSERT para evitar conflito de UNIQUE
        res_of = await db.execute(
            select(OfertaCurso).where(OfertaCurso.codigo_evento == codigo_evento)
        )
        existente = res_of.scalar_one_or_none()

        if existente:
            for campo, valor in dados.items():
                setattr(existente, campo, valor)
            atualizados += 1
        else:
            db.add(OfertaCurso(codigo_evento=codigo_evento, **dados))
            inseridos += 1

    # Flush após cada aba para que a próxima aba encontre os registros no SELECT
    await db.flush()
    return {"inseridos": inseridos, "atualizados": atualizados}
