"""
Importador da planilha de ponto batido (horas trabalhadas).
Colunas esperadas (por nome de cabeçalho):
  COD. LOTAÇÃO | DESC. LOTAÇÃO | DATA INICIAL | DATA FINAL | (vazia) | ID | MATRÍCULA | NOME | HORAS EFETIVAS | HORAS EXTRAS | TOTAL HORAS TRABALHADAS
Valores no CSV podem ter ' (apóstrofo) no início — é removido automaticamente.
"""
import csv
import io
import re
import unicodedata
from datetime import date, datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_

from app.models.ponto import PontoMensal
from app.models.professor import Professor


def _norm_nome(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper().strip())


def _strip(v: str) -> str:
    """Remove apóstrofo inicial e espaços."""
    return v.strip().lstrip("'").strip()


def _norm_col(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower().strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _parse_date(val: str) -> date | None:
    val = _strip(val)
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None


def _parse_horas(val: str) -> float | None:
    """Converte 'HH:MM' (podendo ter H > 24) para float de horas."""
    val = _strip(val)
    if not val or val == "-":
        return None
    m = re.match(r"^(\d+):(\d{2})$", val)
    if m:
        return int(m.group(1)) + int(m.group(2)) / 60.0
    try:
        return float(val.replace(",", "."))
    except ValueError:
        return None


async def importar_ponto(conteudo: bytes, db: AsyncSession) -> dict:
    """
    Lê o CSV, resolve vínculos com professores.
    Substitui registros do mesmo período (data_inicio + data_fim).
    Retorna dict com contadores.
    """
    # Tenta decodificações comuns (CSV do Windows pode vir em latin-1)
    for enc in ("utf-8-sig", "latin-1", "cp1252", "utf-8"):
        try:
            texto = conteudo.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        texto = conteudo.decode("utf-8", errors="replace")

    # Detecta delimitador (CSV brasileiro usa ";" por padrão)
    sample = texto[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ";"  # fallback para Excel pt-BR
    reader = csv.DictReader(io.StringIO(texto), delimiter=delimiter)

    # Normaliza cabeçalhos
    raw_fields = reader.fieldnames or []
    norm_fields = [_norm_col(f) for f in raw_fields]
    col_map = dict(zip(norm_fields, raw_fields))

    def _col(*candidates: str) -> str | None:
        for c in candidates:
            if c in col_map:
                return col_map[c]
        # busca parcial
        for norm, orig in col_map.items():
            for c in candidates:
                if c in norm:
                    return orig
        return None

    COL_NOME = _col("nome", "colaborador")
    COL_DI   = _col("data_inicial", "data_ini", "inicio")
    COL_DF   = _col("data_final", "data_fim", "final")
    COL_HE   = _col("horas_efetivas", "efetivas")
    COL_HX   = _col("horas_extras", "extras")
    COL_HT   = _col("total_horas_trabalhadas", "total_horas", "total")

    if not COL_NOME:
        raise ValueError(
            f"Coluna NOME não encontrada (delimitador='{delimiter}'). "
            f"Colunas detectadas: {', '.join(raw_fields[:15])}"
        )
    if not COL_DI or not COL_DF:
        raise ValueError(
            f"Colunas DATA INICIAL/FINAL não encontradas (delimitador='{delimiter}'). "
            f"Colunas detectadas: {', '.join(raw_fields[:15])}"
        )

    # Pré-carregar professores
    res_prof = await db.execute(select(Professor.id, Professor.nome))
    prof_rows = res_prof.all()
    prof_map: dict[str, int] = {n.strip().upper(): pid for pid, n in prof_rows}
    prof_map_norm: dict[str, int] = {_norm_nome(n): pid for pid, n in prof_rows}

    # Lê todas as linhas
    rows = list(reader)

    # Detecta períodos únicos presentes no arquivo para apagar antes de reinserir
    periodos: set[tuple[date, date]] = set()
    parsed_rows = []
    erros = 0

    for row in rows:
        nome = _strip(row.get(COL_NOME, ""))
        if not nome:
            continue
        di = _parse_date(row.get(COL_DI, ""))
        df = _parse_date(row.get(COL_DF, ""))
        if not di or not df:
            erros += 1
            continue
        he = _parse_horas(row.get(COL_HE, "")) if COL_HE else None
        hx = _parse_horas(row.get(COL_HX, "")) if COL_HX else None
        ht = _parse_horas(row.get(COL_HT, "")) if COL_HT else None
        if ht is None and he is not None:
            ht = (he or 0) + (hx or 0)

        periodos.add((di, df))
        parsed_rows.append((nome, di, df, he, hx, ht))

    # Remove registros dos períodos que serão reimportados
    for di, df in periodos:
        await db.execute(
            delete(PontoMensal).where(
                and_(PontoMensal.data_inicio == di, PontoMensal.data_fim == df)
            )
        )

    inseridos = 0
    for nome, di, df, he, hx, ht in parsed_rows:
        professor_id = prof_map.get(nome.upper()) or prof_map_norm.get(_norm_nome(nome))
        db.add(PontoMensal(
            nome_colaborador=nome,
            data_inicio=di,
            data_fim=df,
            horas_efetivas=he,
            horas_extras=hx,
            horas_total=ht,
            professor_id=professor_id,
        ))
        inseridos += 1

    await db.flush()
    return {"inseridos": inseridos, "erros": erros, "periodos": len(periodos), "delimiter": delimiter}
