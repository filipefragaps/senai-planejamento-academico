"""
Importador da planilha de histórico de agendamentos.
Colunas esperadas:
  Data | Evento | Turno | Horário | Curso | Unidade C | Aula | Subturma |
  Professor | Ambiente | Hora Aula | Etapa | Modalidade | Área | Contrato | Obs | Status
As aulas importadas são marcadas como alterada_manualmente=True (travadas).
"""
import unicodedata
import re
from datetime import date, time, datetime

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.aula import Aula
from app.models.evento import Evento
from app.models.professor import Professor
from app.models.curso import Curso
from app.models.unidade_curricular import UnidadeCurricular
from app.models.oferta import OfertaCurso


# ── helpers ────────────────────────────────────────────────────────────────────

def _norm_col(col: str) -> str:
    col = str(col).lower().strip()
    col = unicodedata.normalize("NFD", col)
    col = "".join(c for c in col if unicodedata.category(c) != "Mn")
    col = re.sub(r"[^a-z0-9]+", "_", col)
    return col.strip("_")


def _get(row: pd.Series, *keys: str) -> str:
    for k in keys:
        v = row.get(k, "")
        if v is None or v is pd.NaT:
            continue
        if isinstance(v, float) and pd.isna(v):
            continue
        s = str(v).strip()
        if s and s not in ("nan", "NaT", "None", "<NA>"):
            return s
    return ""


def _parse_date(val) -> date | None:
    """Converte qualquer representação de data para date.
    Prioriza formatos brasileiros (DD/MM/YYYY) para strings.
    Células Excel de tipo Data chegam como pd.Timestamp — convertidas direto, sem ambiguidade.
    """
    if val is None or val is pd.NaT:
        return None
    if isinstance(val, float) and pd.isna(val):
        return None
    if val == "":
        return None
    # Célula de data nativa do Excel → pd.Timestamp ou datetime (sem ambiguidade)
    if isinstance(val, pd.Timestamp):
        try:
            return val.date()
        except Exception:
            return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s or s in ("nan", "NaT", "None", "NaTType", "<NA>"):
        return None
    # Formatos explícitos — DD/MM primeiro (padrão brasileiro)
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    try:
        return pd.to_datetime(s, dayfirst=True).date()
    except Exception:
        return None


def _parse_time(val) -> time | None:
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, datetime):
        return val.time().replace(second=0, microsecond=0)
    if isinstance(val, time):
        return val.replace(second=0, microsecond=0)
    # Número decimal do Excel (ex: 0.791666... = 19:00)
    if isinstance(val, float):
        total_min = round(val * 24 * 60)
        return time(total_min // 60 % 24, total_min % 60)
    try:
        s = str(val).strip()
        # formato "HH:MM - HH:MM" ou "HH:MM – HH:MM" → pega o primeiro
        if " - " in s or " – " in s:
            s = re.split(r" [-–] ", s)[0].strip()
        # formato "19h" ou "19h00"
        s = re.sub(r"h(\d{2})?", r":\g<1>" if r"\1" else ":00", s)
        s = s.replace("h", ":00")
        # garante HH:MM
        if re.match(r"^\d{1,2}:\d{2}", s):
            return datetime.strptime(s[:5].zfill(5), "%H:%M").time()
        return None
    except Exception:
        return None


def _parse_time_fim(val) -> time | None:
    """Extrai hora de término de uma string 'HH:MM - HH:MM'."""
    if val == "" or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        s = str(val).strip()
        if " - " in s or " – " in s:
            partes = re.split(r" [-–] ", s)
            if len(partes) >= 2:
                return datetime.strptime(partes[1].strip()[:5], "%H:%M").time()
        return None
    except Exception:
        return None


def _norm_status(val: str) -> str:
    upper = val.upper().strip()
    if "REALIZ" in upper:
        return "Realizada"
    if "CANCEL" in upper:
        return "Cancelada"
    if "SUBSTIT" in upper:
        return "Substituída"
    if "REMANEJ" in upper or "REMARC" in upper:
        return "Remarcada"
    return "Agendada"


# Mapa de turno → (horario_inicio, horario_fim)
_TURNOS: dict[str, tuple[time, time]] = {
    "matutino":   (time(9, 0),  time(12, 0)),
    "manha":      (time(9, 0),  time(12, 0)),
    "manhã":      (time(9, 0),  time(12, 0)),
    "vespertino": (time(13, 0), time(17, 0)),
    "tarde":      (time(13, 0), time(17, 0)),
    "noturno":    (time(19, 0), time(22, 0)),
    "noite":      (time(19, 0), time(22, 0)),
    "diurno":     (time(8, 0),  time(17, 0)),
    "integral":   (time(8, 0),  time(17, 0)),
}


def _horarios_do_turno(turno_str: str) -> tuple[time, time] | None:
    """Retorna (h_ini, h_fim) baseado no nome do turno."""
    chave = unicodedata.normalize("NFD", turno_str.lower().strip())
    chave = "".join(c for c in chave if unicodedata.category(c) != "Mn")
    chave = chave.split()[0] if chave else ""
    return _TURNOS.get(chave)


def _turno(h: time | None) -> str:
    if h is None:
        return ""
    if h.hour < 12:
        return "Manhã"
    if h.hour < 18:
        return "Tarde"
    return "Noite"


# ── mapa de dias da semana ─────────────────────────────────────────────────────

_DIAS_MAP: dict[str, int] = {
    "seg": 0, "segunda": 0, "mon": 0,
    "ter": 1, "terca": 1, "tue": 1,
    "qua": 2, "quarta": 2, "wed": 2,
    "qui": 3, "quinta": 3, "thu": 3,
    "sex": 4, "sexta": 4, "fri": 4,
    "sab": 5, "sabado": 5, "sat": 5,
    "dom": 6, "domingo": 6, "sun": 6,
}


def _parse_dias_semana(texto: str) -> list[int]:
    """Converte 'Ter/Qui' ou 'Segunda, Sexta' em [1, 3] ou [0, 4]."""
    if not texto:
        return []
    norm = unicodedata.normalize("NFD", texto)
    norm = "".join(c for c in norm if unicodedata.category(c) != "Mn")
    tokens = re.split(r"[/,;\s]+", norm.lower().strip())
    dias: list[int] = []
    for t in tokens:
        t = t.strip()
        if not t:
            continue
        if t in _DIAS_MAP:
            d = _DIAS_MAP[t]
        else:
            # prefixo de 3 letras (ex: "ter" de "terca")
            d = next((v for k, v in _DIAS_MAP.items() if len(k) >= 3 and t.startswith(k[:3])), None)
        if d is not None and d not in dias:
            dias.append(d)
    return sorted(dias)


def _enrich_from_oferta(evento: "Evento", oferta: "OfertaCurso") -> None:
    """Preenche campos do evento com dados da OfertaCurso ao criar/atualizar."""
    from datetime import datetime as _dt, date as _d

    if not evento.oferta_id:
        evento.oferta_id = oferta.id

    if oferta.hora_inicio and oferta.hora_termino:
        evento.horario_inicio = oferta.hora_inicio
        evento.horario_fim = oferta.hora_termino

    if oferta.carga_horaria:
        evento.carga_horaria_total = float(oferta.carga_horaria)

    if oferta.data_inicio:
        evento.data_inicio = oferta.data_inicio
    if oferta.data_termino:
        evento.data_fim = oferta.data_termino

    if oferta.dias_semana_texto:
        dias = _parse_dias_semana(oferta.dias_semana_texto)
        if dias:
            evento.dias_semana = dias
            if evento.horario_inicio and evento.horario_fim:
                h_ini = _dt.combine(_d.today(), evento.horario_inicio)
                h_fim = _dt.combine(_d.today(), evento.horario_fim)
                horas_dia = max((h_fim - h_ini).seconds / 3600, 0.0)
                evento.horas_semanais = round(horas_dia * len(dias), 2)

    # Área e cidade vão para observações (não há campo específico no Evento)
    partes: list[str] = []
    if oferta.area:
        partes.append(f"Área: {oferta.area}")
    if oferta.cidade:
        partes.append(f"Cidade: {oferta.cidade}")
    if oferta.turno:
        partes.append(f"Turno: {oferta.turno}")
    if partes:
        evento.observacoes = "Importado do histórico | " + " | ".join(partes)


# ── lookup helpers ─────────────────────────────────────────────────────────────

async def _lookup_professor(nome: str, db: AsyncSession) -> int | None:
    if not nome:
        return None
    result = await db.execute(
        select(Professor).where(Professor.nome.ilike(f"%{nome.strip()}%"))
    )
    prof = result.scalars().first()
    return prof.id if prof else None


async def _lookup_ou_criar_evento(
    nome_turma: str, disciplina: str, curso_id: int | None, db: AsyncSession,
    tipo_modalidade: str | None = None,
    oferta: "OfertaCurso | None" = None,
) -> Evento:
    """Busca evento por nome; cria um rascunho se não existir.
    Quando oferta é fornecida, enriquece com dados da OfertaCurso (pasta, horário, dias, CH, etc.)."""
    result = await db.execute(
        select(Evento).where(Evento.nome_turma.ilike(f"%{nome_turma.strip()}%"))
    )
    evento = result.scalars().first()
    if evento:
        if disciplina and disciplina != nome_turma.strip():
            evento.disciplina = disciplina
        if curso_id and not evento.curso_id:
            evento.curso_id = curso_id
        if tipo_modalidade and not evento.tipo_modalidade:
            evento.tipo_modalidade = tipo_modalidade
        if oferta and not evento.oferta_id:
            _enrich_from_oferta(evento, oferta)
        return evento

    evento = Evento(
        nome_turma=nome_turma.strip(),
        disciplina=disciplina or nome_turma.strip(),
        carga_horaria_total=0,
        horas_semanais=0,
        data_inicio=date.today(),
        data_fim=date.today(),
        dias_semana=[],
        horario_inicio=time(8, 0),
        horario_fim=time(12, 0),
        curso_id=curso_id,
        tipo_modalidade=tipo_modalidade,
        status="Ativo",
        observacoes="Importado do histórico",
    )
    if oferta:
        _enrich_from_oferta(evento, oferta)
    db.add(evento)
    await db.flush()
    return evento


async def _lookup_curso(nome_ou_codigo: str, db: AsyncSession) -> int | None:
    if not nome_ou_codigo:
        return None
    nome = nome_ou_codigo.strip()

    # Tentativa por código
    r = await db.execute(select(Curso).where(Curso.codigo.ilike(f"%{nome}%")))
    c = r.scalars().first()
    if c:
        return c.id

    # Tentativa por nome completo
    r2 = await db.execute(select(Curso).where(Curso.nome.ilike(f"%{nome}%")))
    c2 = r2.scalars().first()
    if c2:
        return c2.id

    # Planilhas têm padrões como "NOME - PASTA" ou "NOME - SEDUC - PASTA".
    # O código/pasta é sempre o último segmento; o nome é o primeiro.
    if " - " in nome:
        segmentos = [s.strip() for s in nome.split(" - ")]
        codigo_pasta = segmentos[-1]   # último segmento: "21539" ou "17355"
        nome_base    = segmentos[0]    # primeiro segmento: nome do curso

        # Tenta o código/pasta diretamente (identificador mais confiável)
        if codigo_pasta:
            r3 = await db.execute(select(Curso).where(Curso.codigo.ilike(codigo_pasta)))
            c3 = r3.scalars().first()
            if c3:
                return c3.id

        # Fallback: busca pelo nome sem os sufixos
        r4 = await db.execute(select(Curso).where(Curso.nome.ilike(f"%{nome_base}%")))
        c4 = r4.scalars().first()
        if c4:
            return c4.id

    return None


def _norm_nome(s: str) -> str:
    """Minúsculo sem acentos — para comparação flexível de nomes de UCs."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().strip()


async def _lookup_uc(nome_uc: str, curso_id: int | None, db: AsyncSession) -> int | None:
    if not nome_uc:
        return None

    # Tentativa 1a: correspondência exata case-insensitive (sem substring)
    # Evita "METROLOGIA" casar com "METROLOGIA INDUSTRIAL E DESENHO TÉCNICO"
    q_exato = select(UnidadeCurricular).where(
        UnidadeCurricular.nome.ilike(nome_uc.strip())
    )
    if curso_id:
        q_exato = q_exato.where(UnidadeCurricular.curso_id == curso_id)
    result = await db.execute(q_exato)
    uc = result.scalars().first()
    if uc:
        return uc.id

    # Tentativa 1b: substring — apenas dentro do mesmo curso para evitar contaminação entre cursos
    if curso_id:
        q_sub = select(UnidadeCurricular).where(
            UnidadeCurricular.nome.ilike(f"%{nome_uc.strip()}%"),
            UnidadeCurricular.curso_id == curso_id,
        )
        result = await db.execute(q_sub)
        uc = result.scalars().first()
        if uc:
            return uc.id

    # Tentativa 2: comparação normalizada em Python — somente dentro do curso identificado.
    # Sem curso_id retorna None para não arriscar vincular UC de outro curso.
    if not curso_id:
        return None

    busca_norm = _norm_nome(nome_uc)
    palavras = [p for p in busca_norm.split() if len(p) >= 4]
    if not palavras:
        return None

    result2 = await db.execute(
        select(UnidadeCurricular).where(UnidadeCurricular.curso_id == curso_id)
    )
    candidatos = result2.scalars().all()

    melhor: UnidadeCurricular | None = None
    melhor_score = 0.0

    for u in candidatos:
        u_norm = _norm_nome(u.nome)
        if u_norm == busca_norm:
            return u.id  # correspondência exata normalizada

        # Score bidirecional: mede quanto da busca está no candidato E quanto do candidato
        # está na busca — evita "METROLOGIA" (1 palavra) casar com
        # "METROLOGIA INDUSTRIAL E DESENHO TÉCNICO" (4 palavras) com score 100%.
        palavras_uc = [p for p in u_norm.split() if len(p) >= 4]
        if not palavras_uc:
            continue
        match_busca = sum(1 for p in palavras if p in u_norm) / len(palavras)
        match_uc    = sum(1 for p in palavras if p in u_norm) / len(palavras_uc)
        score = min(match_busca, match_uc)  # ambos os lados precisam ser altos
        if score > melhor_score:
            melhor_score = score
            melhor = u

    if melhor and melhor_score >= 0.70:
        return melhor.id

    return None


# ── serviço principal ──────────────────────────────────────────────────────────

async def importar_historico(conteudo: bytes, db: AsyncSession) -> dict:
    xls = pd.ExcelFile(conteudo)
    sheet = xls.sheet_names[0]
    # Sem dtype=str: células de data chegam como pd.Timestamp (sem ambiguidade DD/MM vs MM/DD).
    # _get e _parse_date tratam NaN/NaT nativamente.
    df = pd.read_excel(xls, sheet_name=sheet)
    df.columns = [_norm_col(c) for c in df.columns]

    inseridas = 0
    atualizadas = 0
    ignoradas = 0
    ignoradas_sem_data = 0
    ignoradas_sem_horario = 0
    eventos_criados = 0
    erros: list[str] = []
    vistos: set[tuple] = set()
    eventos_antes: set[str] = set()  # controla quais eventos já existiam

    # Cache para evitar múltiplas queries do mesmo nome
    cache_prof: dict[str, int | None] = {}
    cache_evento: dict[str, Evento] = {}
    cache_curso: dict[str, int | None] = {}
    cache_oferta: dict[str, "OfertaCurso | None"] = {}

    for idx, row in df.iterrows():
        linha = idx + 2  # número da linha no Excel (considerando cabeçalho)
        try:
            data_aula = _parse_date(
                row.get("data", row.get("data_aula", ""))
            )
            if data_aula is None:
                ignoradas += 1
                ignoradas_sem_data += 1
                continue

            horario_raw = _get(row, "horario", "horario_aula", "hora")
            h_ini = _parse_time(horario_raw)
            h_fim = _parse_time_fim(horario_raw)

            # Fallback: usar turno para inferir horários quando não vêm no campo Horário
            turno_col = _get(row, "turno")
            if turno_col:
                turnos_horas = _horarios_do_turno(turno_col)
                if turnos_horas:
                    if h_ini is None:
                        h_ini = turnos_horas[0]
                    if h_fim is None:
                        h_fim = turnos_horas[1]

            if h_ini is None:
                ignoradas += 1
                ignoradas_sem_horario += 1
                if ignoradas_sem_horario <= 3:
                    erros.append(f"Linha {linha}: sem horário (turno='{turno_col}', horário='{horario_raw}')")
                continue

            # Deduplicação
            nome_turma = _get(row, "evento", "turma", "nome_turma")
            chave = (nome_turma.lower(), str(data_aula), str(h_ini))
            if chave in vistos:
                ignoradas += 1
                continue
            vistos.add(chave)

            # Lookup / criação de entidades
            nome_curso = _get(row, "curso")
            if nome_curso not in cache_curso:
                cache_curso[nome_curso] = await _lookup_curso(nome_curso, db)
            curso_id = cache_curso[nome_curso]

            # Busca oferta pelo código do evento (nome_turma)
            if nome_turma not in cache_oferta:
                res_of = await db.execute(
                    select(OfertaCurso).where(OfertaCurso.codigo_evento == nome_turma.strip())
                )
                cache_oferta[nome_turma] = res_of.scalar_one_or_none()
            oferta = cache_oferta[nome_turma]

            # Se não resolveu curso_id pela planilha, tenta via pasta da oferta
            if not curso_id and oferta and oferta.pasta:
                if oferta.pasta not in cache_curso:
                    cache_curso[oferta.pasta] = await _lookup_curso(oferta.pasta, db)
                curso_id = cache_curso[oferta.pasta]

            # disciplina deve ser o nome do CURSO, não da UC
            disciplina = (nome_curso or _get(row, "unidade_c", "unidade_curricular", "uc") or nome_turma).upper()

            tipo_modalidade = _get(row, "modalidade") or (oferta.modalidade if oferta else None) or None

            if nome_turma not in cache_evento:
                era_novo = not (await db.execute(
                    select(Evento.id).where(Evento.nome_turma.ilike(f"%{nome_turma.strip()}%"))
                )).scalar_one_or_none()
                cache_evento[nome_turma] = await _lookup_ou_criar_evento(
                    nome_turma, disciplina, curso_id, db,
                    tipo_modalidade=tipo_modalidade,
                    oferta=oferta,
                )
                if era_novo:
                    eventos_criados += 1
            evento = cache_evento[nome_turma]

            nome_prof = _get(row, "professor")
            if nome_prof not in cache_prof:
                cache_prof[nome_prof] = await _lookup_professor(nome_prof, db)
            professor_id = cache_prof[nome_prof]

            uc_nome = _get(row, "unidade_c", "unidade_curricular", "uc").upper()
            uc_id = await _lookup_uc(uc_nome, curso_id, db)

            etapa = _get(row, "etapa", "modulo", "etapa_modulo")
            turno_raw = _get(row, "turno") or _turno(h_ini)
            ambiente = _get(row, "ambiente", "sala", "arga")
            subturma = _get(row, "subturma")
            status = _norm_status(_get(row, "status", "status_etapa", "situacao"))
            obs = _get(row, "obs", "observacoes", "observacao")
            tipo_contrato = _get(row, "contrato", "tipo_contrato")
            num_aula_raw = _get(row, "aula", "numero_aula")
            try:
                numero_aula = int(float(num_aula_raw)) if num_aula_raw else None
            except (ValueError, TypeError):
                numero_aula = None

            # Upsert: verifica se já existe aula nesse evento/data/horário
            res_ex = await db.execute(
                select(Aula).where(
                    and_(
                        Aula.evento_id == evento.id,
                        Aula.data == data_aula,
                        Aula.horario_inicio == h_ini,
                    )
                )
            )
            existente = res_ex.scalar_one_or_none()

            if existente:
                existente.professor_id = professor_id
                # Preserva vínculo existente se o novo lookup falhou
                existente.unidade_curricular_id = uc_id or existente.unidade_curricular_id
                existente.uc_nome_original = uc_nome or existente.uc_nome_original
                existente.horario_fim = h_fim or existente.horario_fim
                existente.etapa = etapa or existente.etapa
                existente.turno = turno_raw or existente.turno
                existente.ambiente = ambiente or existente.ambiente
                existente.subturma = subturma or existente.subturma
                existente.status = status
                existente.observacoes = obs or existente.observacoes
                existente.tipo_contrato = tipo_contrato or existente.tipo_contrato
                existente.numero_aula = numero_aula or existente.numero_aula
                existente.alterada_manualmente = True
                atualizadas += 1
            else:
                aula = Aula(
                    evento_id=evento.id,
                    professor_id=professor_id,
                    unidade_curricular_id=uc_id,
                    uc_nome_original=uc_nome or None,
                    data=data_aula,
                    horario_inicio=h_ini,
                    horario_fim=h_fim or h_ini,
                    etapa=etapa or None,
                    turno=turno_raw or None,
                    ambiente=ambiente or None,
                    subturma=subturma or None,
                    numero_aula=numero_aula,
                    status=status,
                    tipo="Regular",
                    observacoes=obs or None,
                    tipo_contrato=tipo_contrato or None,
                    alterada_manualmente=True,
                )
                db.add(aula)
                inseridas += 1

        except Exception as exc:
            erros.append(f"Linha {linha}: {exc}")

    await db.flush()
    return {
        "inseridas": inseridas,
        "atualizadas": atualizadas,
        "ignoradas": ignoradas,
        "ignoradas_sem_data": ignoradas_sem_data,
        "ignoradas_sem_horario": ignoradas_sem_horario,
        "eventos_criados": eventos_criados,
        "colunas_encontradas": list(df.columns),
        "erros": erros[:20],
    }
