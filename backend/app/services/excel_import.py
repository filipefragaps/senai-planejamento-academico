"""
Importação da planilha Excel do SENAI.

Abas e colunas reais:
  PROFESSORES            : PROFESSOR | ÁREA | TIPO | CH | S | T | Q | Q | S
  ATUAÇÃO                : PROFESSOR | CURSO | PASTA | MODALIDADE | MÓDULO/ETAPA |
                           UC | TIPO | cod UC | UNIDADE CURRICULAR | CARGA HORÁRIA | AT
  DISPONIBILIDADE DETALHADA: PROFESSOR | DIA_SEMANA | HORA_INICIO | HORA_FIM |
                              DISPONIVEL | TIPO_BLOQUEIO | OBSERVAÇÃO
  CALENDÁRIO ACADÊMICO   : DATA | TIPO | LETIVO | TURNO | DESCRIÇÃO
  CURSOS                 : (colunas variáveis — cursos extraídos da aba ATUAÇÃO)
"""
import io
from datetime import time, date, datetime
from typing import Any

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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
    """Normaliza nome de coluna: lower, sem acentos, espaços/separadores → _"""
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


def _norm_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={c: _norm_col(c) for c in df.columns})
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

        # 2. Cursos: PASTA = código da matriz (PPC); cada PASTA é um Curso no BD.
        #    Deve vir ANTES de ATUAÇÃO para que os curso_ids existam.
        if "cursos" in sheets:
            resultado["cursos"] = await self._cursos(xls, sheets["cursos"], db)
            await db.flush()

        # 3. Atuação: mapeia professor → disciplina → PASTA (curso_id já no BD)
        atua_sheet = next((v for k, v in sheets.items() if "atua" in k), None)
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
    # Colunas: PROFESSOR | ÁREA | TIPO | CH | S | T | Q | Q | S
    async def _professores(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(pd.read_excel(xls, sheet_name=sheet, dtype=str))
        count = 0
        for _, row in df.iterrows():
            nome = _get(row, "professor", "nome")
            if not nome:
                continue

            tipo_raw = _get(row, "tipo", default="Mensalista")
            tipo = "Horista" if "horista" in tipo_raw.lower() else "Mensalista"

            # CH = Carga Horária semanal (coluna "ch" ou "horas_contratadas")
            horas = _parse_float(_get(row, "ch", "horas_contratadas", "carga_horaria"), 40.0)

            # ÁREA → especialidades
            especialidade = _get(row, "area", "area_de_atuacao", "especialidades") or None

            res = await db.execute(select(Professor).where(Professor.nome == nome))
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

    # ─── ATUAÇÃO ─────────────────────────────────────────────────────────────────
    # Colunas: PROFESSOR | CURSO | PASTA | MODALIDADE | MÓDULO/ETAPA |
    #          UC | TIPO | cod UC | UNIDADE CURRICULAR | CARGA HORÁRIA | AT
    #
    # PASTA identifica a matriz curricular (PPC). Cursos já devem existir no BD
    # (importados da aba CURSOS antes desta). O mesmo professor pode ensinar a
    # mesma disciplina em PASTAs diferentes — são registros distintos.
    async def _atuacoes(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(pd.read_excel(xls, sheet_name=sheet, dtype=str))

        # Cache PASTA → curso_id para evitar queries repetidas
        cache_curso: dict[str, int | None] = {}

        # Rastreia o que já foi inserido nesta transação (evita duplicata dentro da importação)
        inseridos: set[tuple] = set()
        cnt = 0

        for _, row in df.iterrows():
            nome_prof = _get(row, "professor")
            disciplina = _get(row, "unidade_curricular", "disciplina", "uc")
            if not nome_prof or not disciplina:
                continue

            # AT = NÃO → professor não está habilitado nesta disciplina/pasta
            at_val = _get(row, "at").upper()
            if at_val in ("NÃO", "NAO", "N", "NO"):
                continue

            res_p = await db.execute(select(Professor).where(Professor.nome == nome_prof))
            professor = res_p.scalar_one_or_none()
            if not professor:
                continue

            # Resolve curso_id pelo código PASTA
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
                # Atualiza a modalidade mesmo que o registro já exista
                existente.modalidade = modalidade

            inseridos.add(chave)

        return cnt

    # ─── CURSOS ───────────────────────────────────────────────────────────────────
    # Colunas: A=CURSO (nome) | B=PASTA (código PPC) | C=MODALIDADE |
    #          D=MÓDULO/ETAPA | E=UC (seq) | F=TIPO | G=cod UC | H=UNIDADE CURRICULAR | I=CARGA HORÁRIA
    # Cada linha é uma UC. Agrupamos por PASTA para criar/atualizar o Curso e
    # salvamos cada UC individualmente na tabela unidades_curriculares.
    async def _cursos(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(pd.read_excel(xls, sheet_name=sheet, dtype=str))

        cod_col  = next((c for c in df.columns if c in ("pasta","cod_curso","codigo_curso","codigo")), None)
        nome_col = next((c for c in df.columns if c in ("curso","nome_curso","nome","habilitacao")), None)
        if not cod_col or not nome_col:
            return 0

        ch_col      = next((c for c in df.columns if "carga" in c), None)
        uc_seq_col  = next((c for c in df.columns if c == "uc"), None)
        tipo_col    = next((c for c in df.columns if c == "tipo"), None)
        modulo_col  = next((c for c in df.columns if "modulo" in c or "etapa" in c), None)
        cod_uc_col  = next((c for c in df.columns if "cod_uc" in c or c == "cod_uc"), None)
        nome_uc_col = next((c for c in df.columns if "unidade" in c), None)

        # Passe 1: agrupa por PASTA para calcular totais e criar Cursos
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
            carga_total = int(info["carga"])
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

        # Passe 2: salva cada UC individualmente
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

    # ─── DISPONIBILIDADE DETALHADA ────────────────────────────────────────────────
    # Colunas: PROFESSOR | DIA_SEMANA | HORA_INICIO | HORA_FIM |
    #          DISPONIVEL | TIPO_BLOQUEIO | OBSERVAÇÃO
    async def _disponibilidades(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(pd.read_excel(xls, sheet_name=sheet))
        # Cache professor_nome → id para evitar queries repetidas
        cache_prof: dict[str, int] = {}
        count = 0

        for _, row in df.iterrows():
            nome_prof = _str(row.get("professor"))
            if not nome_prof:
                continue

            if nome_prof not in cache_prof:
                res = await db.execute(select(Professor).where(Professor.nome == nome_prof))
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
    # Colunas: DATA | TIPO | LETIVO | TURNO | DESCRIÇÃO
    # Todos os registros são dias NÃO-letivos (feriados, recessos, férias dos alunos etc.)
    async def _calendario(self, xls: pd.ExcelFile, sheet: str, db: AsyncSession) -> int:
        df = _norm_df(pd.read_excel(xls, sheet_name=sheet))
        count = 0

        _TIPOS_NAO_LETIVOS = {
            "feriado", "recesso", "ferias", "férias", "folga",
            "compensacao", "compensação", "sem aula", "sem_aula",
            "nao letivo", "não letivo",
        }

        for _, row in df.iterrows():
            data_val = _parse_date(row.get("data"))
            tipo_raw = _str(row.get("tipo"))
            if data_val is None or not tipo_raw:
                continue

            tipo = tipo_raw

            # Campo LETIVO da planilha (SIM/NÃO) — tem prioridade sobre o tipo
            letivo_raw = _str(row.get("letivo", "")).upper().strip()
            if letivo_raw in ("NAO", "NÃO", "N", "0", "FALSE", "NO"):
                letivo = False
            elif letivo_raw in ("SIM", "S", "1", "TRUE", "YES"):
                letivo = True
            else:
                # Infere pelo tipo quando coluna LETIVO não preenchida
                letivo = tipo_raw.lower().strip() not in _TIPOS_NAO_LETIVOS

            descricao = _get(row, "descricao", "descricao_1") or tipo_raw.replace("_", " ").capitalize()
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
