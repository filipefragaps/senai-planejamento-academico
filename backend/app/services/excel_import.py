"""
Importação da planilha Excel do SENAI.

Abas e colunas reais:
  PROFESSORES            : PROFESSOR | ÁREA | TIPO | CH | S | T | Q | Q | S
  ATUAÇÃO                : PROFESSOR | CURSO | PASTA | MODALIDADE | MÓDULO/ETAPA |
                           UC | TIPO | cod UC | UNIDADE CURRICULAR | CARGA HORÁRIA | AT
  DISPONIBILIDADE DETALHADA: PROFESSOR | DIA_SEMANA | HORA_INICIO | HORA_FIM |
                              DISPONIVEL | TIPO_BLOQUEIO | OBSERVAÇÃO
  CALENDÁRIO ACADÊMICO   : DATA | TIPO | LETIVO | TURNO | DESCRIÇÃO
  CURSOS                 : (colunas variáveis — cursos extraídos da aba ATUAÇÃO se não existir)
"""
import io
from datetime import time, date, datetime
from typing import Any

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.curso import Curso
from app.models.unidade_curricular import UnidadeCurricular
from app.models.professor import Professor
from app.models.atuacao import Atuacao
from app.models.disponibilidade import DisponibilidadeDetalhada
from app.models.calendario import CalendarioAcademico


DIAS_SEMANA_MAP = {
    "segunda": 0, "segunda-feira": 0, "seg": 0,
    "terça": 1, "terca": 1, "terça-feira": 1, "ter": 1,
    "quarta": 2, "quarta-feira": 2, "qua": 2,
    "quinta": 3, "quinta-feira": 3, "qui": 3,
    "sexta": 4, "sexta-feira": 4, "sex": 4,
    "sábado": 5, "sabado": 5, "sab": 5, "sáb": 5,
    "domingo": 6, "dom": 6,
}


def _norm_col(name: str) -> str:
    n = str(name).strip().lower()
    for src, dst in [
        ("ã","a"),("á","a"),("â","a"),("à","a"),("ä","a"),
        ("ç","c"),("é","e"),("ê","e"),("è","e"),
        ("í","i"),("ì","i"),("ó","o"),("ô","o"),("ò","o"),
        ("ú","u"),("ù","u"),("ü","u"),
        (" ","_"),("/","_"),("-","_"),(".","_"),
    ]:
        n = n.replace(src, dst)
    while "__" in n:
        n = n.replace("__", "_")
    return n.strip("_")


def _norm_df(df: pd.DataFrame, ffill_cols: list[str] | None = None) -> pd.DataFrame:
    """Normaliza colunas e aplica forward-fill em colunas com células mescladas."""
    df = df.rename(columns={c: _norm_col(c) for c in df.columns})
    # Remove linhas completamente vazias
    df = df.dropna(how="all")
    if ffill_cols:
        for col in ffill_cols:
            if col in df.columns:
                df[col] = df[col].ffill()
    return df


def _str(val: Any, default: str = "") -> str:
    if val is None:
        return default
    if isinstance(val, float) and pd.isna(val):
        return default
    return str(val).strip()


def _parse_float(val: Any, default: float = 0.0) -> float:
    s = _str(val)
    if not s:
        return default
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return default


def _parse_time(val: Any) -> time | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, time):
        return val
    if isinstance(val, datetime):
        return val.time()
    s = str(val).strip()
    for fmt in ("%H:%M:%S", "%H:%M", "%H.%M"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            pass
    return None


def _parse_date(val: Any) -> date | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def _parse_dia(val: Any) -> int | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    return DIAS_SEMANA_MAP.get(str(val).strip().lower())


def _is_sim(val: Any) -> bool:
    return _str(val).upper() in ("SIM", "S", "1", "TRUE", "VERDADEIRO")


def _get(row: pd.Series, *keys: str, default: str = "") -> str:
    for k in keys:
        v = row.get(k)
        if v is not None and not (isinstance(v, float) and pd.isna(v)):
            s = str(v).strip()
            if s:
                return s
    return default


def _col_first(df: pd.DataFrame, *candidates: str) -> str | None:
    """Retorna o primeiro nome de coluna que existe no DataFrame."""
    for c in candidates:
        if c in df.columns:
            return c
    return None


class ExcelImportService:

    async def importar(self, file_bytes: bytes, db: AsyncSession) -> dict:
        xls = pd.ExcelFile(io.BytesIO(file_bytes))
        resultado: dict = {
            "cursos": 0, "professores": 0, "atuacoes": 0,
            "disponibilidades": 0, "calendario": 0, "erros": [],
        }

        sheets = {s.strip().lower(): s for s in xls.sheet_names}

        # 1. Professores primeiro
        prof_sheet = next((v for k, v in sheets.items() if "professor" in k), None)
        if prof_sheet:
            resultado["professores"] = await self._professores(xls, prof_sheet, db)
            await db.flush()

        # 2. Cursos: tenta aba dedicada; senão extrai da aba ATUAÇÃO
        atua_sheet = next((v for k, v in sheets.items() if "atua" in k), None)
        cursos_sheet = next((v for k, v in sheets.items() if "cursos" in k or "curso" in k), None)

        if cursos_sheet:
            resultado["cursos"] = await self._cursos(xls, cursos_sheet, db)
        elif atua_sheet:
            resultado["cursos"] = await self._cursos_da_atuacao(xls, atua_sheet, db)
        await db.flush()

        # 3. Atuação
        if atua_sheet:
            resultado["atuacoes"] = await self._atuacoes(xls, atua_sheet, db)
            await db.flush()

        # 4. Disponibilidade
        disp_sheet = next((v for k, v in sheets.items() if "disponib" in k), None)
        if disp_sheet:
            resultado["disponibilidades"] = await self._disponibilidades(xls, disp_sheet, db)

        # 5. Calendário
        cal_sheet = next((v for k, v in sheets.items() if "calend" in k), None)
        if cal_sheet:
            resultado["calendario"] = await self._calendario(xls, cal_sheet, db)

        await db.commit()
        return resultado

    # ─── PROFESSORES ─────────────────────────────────────────────────────────────
    async def _professores(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(pd.read_excel(xls, sheet_name=sheet, dtype=str))
        count = 0
        for _, row in df.iterrows():
            nome = _get(row, "professor", "nome")
            if not nome:
                continue

            tipo_raw = _get(row, "tipo", default="Mensalista")
            tipo = "Horista" if "horista" in tipo_raw.lower() else "Mensalista"

            horas = _parse_float(_get(row, "ch", "horas_contratadas", "carga_horaria"), 40.0)
            especialidade = _get(row, "area", "area_de_atuacao", "especialidades") or None

            res = await db.execute(
                select(Professor).where(func.lower(Professor.nome) == nome.lower())
            )
            existing = res.scalar_one_or_none()
            dados = {
                "nome": nome,
                "tipo": tipo,
                "horas_contratadas": horas,
                "especialidades": especialidade,
                "ativo": True,
            }
            if existing:
                for k, v in dados.items():
                    setattr(existing, k, v)
            else:
                db.add(Professor(**dados))
            count += 1
        return count

    # ─── CURSOS (aba dedicada) ────────────────────────────────────────────────────
    async def _cursos(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        # Aplica ffill nas colunas que costumam ter células mescladas
        df = _norm_df(
            pd.read_excel(xls, sheet_name=sheet, dtype=str),
            ffill_cols=["pasta", "curso", "cod_curso", "codigo", "nome"],
        )

        cod_col  = _col_first(df, "pasta", "cod_curso", "codigo_curso", "codigo")
        nome_col = _col_first(df, "curso", "nome_curso", "nome", "habilitacao")
        if not cod_col or not nome_col:
            return 0

        ch_col      = next((c for c in df.columns if "carga" in c), None)
        uc_seq_col  = _col_first(df, "uc")
        tipo_col    = _col_first(df, "tipo")
        modulo_col  = next((c for c in df.columns if "modulo" in c or "etapa" in c), None)
        cod_uc_col  = next((c for c in df.columns if "cod_uc" in c), None)
        nome_uc_col = next((c for c in df.columns if "unidade" in c), None)

        cursos_map: dict[str, dict] = {}
        for _, row in df.iterrows():
            cod  = _str(row.get(cod_col))
            nome = _str(row.get(nome_col))
            if not cod or not nome:
                continue
            if cod not in cursos_map:
                cursos_map[cod] = {"nome": nome, "carga": 0.0}
            if ch_col:
                cursos_map[cod]["carga"] += _parse_float(row.get(ch_col))

        count = 0
        curso_id_map: dict[str, int] = {}
        for cod, info in cursos_map.items():
            carga_total = int(info["carga"]) if info["carga"] > 0 else 0
            res = await db.execute(select(Curso).where(Curso.codigo == cod))
            existing = res.scalar_one_or_none()
            if not existing:
                novo = Curso(
                    codigo=cod,
                    nome=info["nome"],
                    carga_horaria_total=carga_total,
                    modalidade="Presencial",
                    ativo=True,
                )
                db.add(novo)
                await db.flush()
                curso_id_map[cod] = novo.id
                count += 1
            else:
                existing.nome = info["nome"]
                if carga_total > 0:
                    existing.carga_horaria_total = carga_total
                curso_id_map[cod] = existing.id

        await db.flush()

        if nome_uc_col and cod_uc_col:
            for _, row in df.iterrows():
                cod_pasta = _str(row.get(cod_col))
                curso_id  = curso_id_map.get(cod_pasta)
                if not curso_id:
                    continue
                codigo_uc = _str(row.get(cod_uc_col))
                nome_uc   = _str(row.get(nome_uc_col))
                if not codigo_uc or not nome_uc:
                    continue
                res_uc = await db.execute(
                    select(UnidadeCurricular).where(
                        UnidadeCurricular.curso_id == curso_id,
                        UnidadeCurricular.codigo_uc == codigo_uc,
                    )
                )
                existing_uc = res_uc.scalar_one_or_none()
                dados_uc = {
                    "nome":        nome_uc,
                    "tipo":        _str(row.get(tipo_col), "Presencial").capitalize() if tipo_col else "Presencial",
                    "modulo_etapa": _str(row.get(modulo_col)) if modulo_col else None,
                    "sequencia":   int(_parse_float(row.get(uc_seq_col))) if uc_seq_col else None,
                    "carga_horaria": int(_parse_float(row.get(ch_col))) if ch_col else 0,
                }
                if not existing_uc:
                    db.add(UnidadeCurricular(curso_id=curso_id, codigo_uc=codigo_uc, **dados_uc))
                else:
                    for k, v in dados_uc.items():
                        setattr(existing_uc, k, v)

        return count

    # ─── CURSOS (extraídos da aba ATUAÇÃO) ───────────────────────────────────────
    async def _cursos_da_atuacao(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        """Extrai cursos únicos da aba ATUAÇÃO (PASTA=código, CURSO=nome)."""
        df = _norm_df(
            pd.read_excel(xls, sheet_name=sheet, dtype=str),
            ffill_cols=["professor", "pasta", "curso", "modalidade", "modulo_etapa"],
        )

        cod_col  = _col_first(df, "pasta", "cod_curso", "codigo")
        nome_col = _col_first(df, "curso", "nome_curso", "nome")
        ch_col   = next((c for c in df.columns if "carga" in c), None)

        # Colunas de UC para criar UnidadeCurricular junto com o Curso
        cod_uc_col  = next((c for c in df.columns if "cod_uc" in c), None)
        nome_uc_col = next((c for c in df.columns if "unidade" in c), None)
        modulo_col  = next((c for c in df.columns if "modulo" in c or "etapa" in c), None)
        uc_seq_col  = _col_first(df, "uc")
        tipo_col    = _col_first(df, "tipo")

        if not cod_col or not nome_col:
            return 0

        # Acumula CH total por PASTA
        cursos_map: dict[str, dict] = {}
        for _, row in df.iterrows():
            cod  = _str(row.get(cod_col))
            nome = _str(row.get(nome_col))
            if not cod or not nome:
                continue
            if cod not in cursos_map:
                cursos_map[cod] = {"nome": nome, "carga": 0.0}
            if ch_col:
                cursos_map[cod]["carga"] += _parse_float(row.get(ch_col))

        count = 0
        curso_id_map: dict[str, int] = {}
        for cod, info in cursos_map.items():
            carga_total = int(info["carga"]) if info["carga"] > 0 else 0
            res = await db.execute(select(Curso).where(Curso.codigo == cod))
            existing = res.scalar_one_or_none()
            if not existing:
                novo = Curso(
                    codigo=cod,
                    nome=info["nome"],
                    carga_horaria_total=carga_total,
                    modalidade="Presencial",
                    ativo=True,
                )
                db.add(novo)
                await db.flush()
                curso_id_map[cod] = novo.id
                count += 1
            else:
                existing.nome = info["nome"]
                if carga_total > 0:
                    existing.carga_horaria_total = carga_total
                curso_id_map[cod] = existing.id

        await db.flush()

        # Cria UnidadeCurricular se colunas existirem
        if nome_uc_col and cod_uc_col:
            for _, row in df.iterrows():
                cod_pasta = _str(row.get(cod_col))
                curso_id  = curso_id_map.get(cod_pasta)
                if not curso_id:
                    continue
                codigo_uc = _str(row.get(cod_uc_col))
                nome_uc   = _str(row.get(nome_uc_col))
                if not codigo_uc or not nome_uc:
                    continue
                res_uc = await db.execute(
                    select(UnidadeCurricular).where(
                        UnidadeCurricular.curso_id == curso_id,
                        UnidadeCurricular.codigo_uc == codigo_uc,
                    )
                )
                existing_uc = res_uc.scalar_one_or_none()
                dados_uc = {
                    "nome":        nome_uc,
                    "tipo":        _str(row.get(tipo_col), "Presencial").capitalize() if tipo_col else "Presencial",
                    "modulo_etapa": _str(row.get(modulo_col)) if modulo_col else None,
                    "sequencia":   int(_parse_float(row.get(uc_seq_col))) if uc_seq_col else None,
                    "carga_horaria": int(_parse_float(row.get(ch_col))) if ch_col else 0,
                }
                if not existing_uc:
                    db.add(UnidadeCurricular(curso_id=curso_id, codigo_uc=codigo_uc, **dados_uc))
                else:
                    for k, v in dados_uc.items():
                        setattr(existing_uc, k, v)

        return count

    # ─── ATUAÇÃO ─────────────────────────────────────────────────────────────────
    async def _atuacoes(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        # ffill em colunas que costumam ter células mescladas
        df = _norm_df(
            pd.read_excel(xls, sheet_name=sheet, dtype=str),
            ffill_cols=["professor", "pasta", "curso", "modalidade", "modulo_etapa"],
        )

        cache_curso: dict[str, int | None] = {}
        inseridos: set[tuple] = set()
        cnt = 0

        for _, row in df.iterrows():
            nome_prof = _get(row, "professor")
            disciplina = _get(row, "unidade_curricular", "disciplina", "uc")
            if not nome_prof or not disciplina:
                continue

            # AT = NÃO → professor explicitamente marcado como inapto
            at_val = _get(row, "at").strip().upper()
            if at_val in ("NÃO", "NAO", "N", "NO", "INAPTO", "NAO_APTO"):
                continue

            # Busca case-insensitive para tolerar variações de capitalização
            res_p = await db.execute(
                select(Professor).where(func.lower(Professor.nome) == nome_prof.lower())
            )
            professor = res_p.scalar_one_or_none()
            if not professor:
                continue

            cod_pasta = _get(row, "pasta", "cod_curso")
            if cod_pasta not in cache_curso:
                res_c = await db.execute(select(Curso).where(Curso.codigo == cod_pasta))
                c = res_c.scalar_one_or_none()
                cache_curso[cod_pasta] = c.id if c else None
            curso_id = cache_curso[cod_pasta]

            chave = (professor.id, disciplina, curso_id)
            if chave in inseridos:
                continue

            modalidade = _get(row, "modalidade") or "Habilitação Técnica"

            res_at = await db.execute(
                select(Atuacao).where(
                    Atuacao.professor_id == professor.id,
                    Atuacao.disciplina == disciplina,
                    Atuacao.curso_id == curso_id,
                )
            )
            existente = res_at.scalar_one_or_none()
            if not existente:
                db.add(Atuacao(
                    professor_id=professor.id,
                    curso_id=curso_id,
                    disciplina=disciplina,
                    modalidade=modalidade,
                    nivel_competencia=3,
                ))
                cnt += 1
            else:
                existente.modalidade = modalidade

            inseridos.add(chave)

        return cnt

    # ─── DISPONIBILIDADE DETALHADA ────────────────────────────────────────────────
    async def _disponibilidades(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(
            pd.read_excel(xls, sheet_name=sheet),
            ffill_cols=["professor"],
        )
        cache_prof: dict[str, int] = {}
        count = 0

        for _, row in df.iterrows():
            nome_prof = _str(row.get("professor"))
            if not nome_prof:
                continue

            if nome_prof not in cache_prof:
                res = await db.execute(
                    select(Professor).where(func.lower(Professor.nome) == nome_prof.lower())
                )
                p = res.scalar_one_or_none()
                cache_prof[nome_prof] = p.id if p else -1
            prof_id = cache_prof[nome_prof]
            if prof_id == -1:
                continue

            dia = _parse_dia(row.get("dia_semana") or row.get("dia"))
            h_ini = _parse_time(row.get("hora_inicio") or row.get("horario_inicio"))
            h_fim = _parse_time(row.get("hora_fim") or row.get("horario_fim"))
            if dia is None or h_ini is None or h_fim is None:
                continue

            disp_raw = _str(row.get("disponivel") or row.get("tipo_disponibilidade"), "SIM")
            tipo_disp = "Disponível" if _is_sim(disp_raw) else "Indisponível"

            res_d = await db.execute(
                select(DisponibilidadeDetalhada).where(
                    DisponibilidadeDetalhada.professor_id == prof_id,
                    DisponibilidadeDetalhada.dia_semana == dia,
                    DisponibilidadeDetalhada.horario_inicio == h_ini,
                    DisponibilidadeDetalhada.horario_fim == h_fim,
                )
            )
            if not res_d.scalar_one_or_none():
                db.add(DisponibilidadeDetalhada(
                    professor_id=prof_id,
                    dia_semana=dia,
                    horario_inicio=h_ini,
                    horario_fim=h_fim,
                    tipo_disponibilidade=tipo_disp,
                ))
            count += 1

        return count

    # ─── CALENDÁRIO ACADÊMICO ─────────────────────────────────────────────────────
    async def _calendario(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(pd.read_excel(xls, sheet_name=sheet))
        count = 0

        _TIPOS_NAO_LETIVOS = {
            "feriado", "recesso", "ferias", "férias", "folga",
            "compensacao", "compensação", "sem aula", "sem_aula",
            "nao letivo", "não letivo",
        }

        # Detecta coluna de data (pode ter nomes variados)
        data_col = _col_first(df, "data", "date", "dt")
        tipo_col = _col_first(df, "tipo", "type", "evento", "descricao_tipo")

        for _, row in df.iterrows():
            data_val = _parse_date(row.get(data_col) if data_col else row.get("data"))
            tipo_raw = _str(row.get(tipo_col) if tipo_col else row.get("tipo"))
            if data_val is None or not tipo_raw:
                continue

            tipo = tipo_raw

            letivo_raw = _str(row.get("letivo", "")).upper().strip()
            if letivo_raw in ("NAO", "NÃO", "N", "0", "FALSE", "NO"):
                letivo = False
            elif letivo_raw in ("SIM", "S", "1", "TRUE", "YES"):
                letivo = True
            else:
                letivo = tipo_raw.lower().strip() not in _TIPOS_NAO_LETIVOS

            descricao = _get(row, "descricao", "descricao_1", "observacao") or tipo_raw.replace("_", " ").capitalize()
            periodo = _get(row, "turno", "periodo") or None

            res = await db.execute(
                select(CalendarioAcademico).where(
                    CalendarioAcademico.data == data_val,
                    CalendarioAcademico.tipo == tipo,
                )
            )
            existing = res.scalar_one_or_none()
            if not existing:
                db.add(CalendarioAcademico(
                    data=data_val,
                    tipo=tipo,
                    letivo=letivo,
                    descricao=descricao or None,
                    periodo=periodo,
                ))
                count += 1
            else:
                existing.letivo = letivo
                existing.descricao = descricao or None
                existing.periodo = periodo
        return count


excel_import_service = ExcelImportService()
