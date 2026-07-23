"""
Router de Planejamento Automático de Cronogramas.
v2
"""
import re
import unicodedata
from datetime import date, time, datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.database import get_db
from app.core.deps import get_current_user
from app.config import settings
from app.models.aula import Aula
from app.models.evento import Evento
from app.models.oferta import OfertaCurso
from app.models.professor import Professor
from app.models.unidade_curricular import UnidadeCurricular
from app.models.curso import Curso
from app.services.planejamento_service import gerar_planejamento, confirmar_planejamento, analisar_proprio, PlanejamentoResult
from app.services.regencia import calcular_regencia_professor

router = APIRouter(prefix="/planejamento", tags=["Planejamento"])


# ── Helpers internos ───────────────────────────────────────────────────────────

_DIAS_MAP = {
    "seg": 0, "segunda": 0,
    "ter": 1, "terca": 1, "terca-feira": 1,
    "qua": 2, "quarta": 2,
    "qui": 3, "quinta": 3,
    "sex": 4, "sexta": 4,
    "sab": 5, "sabado": 5,
    "dom": 6, "domingo": 6,
}

def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()

def _parsear_dias_semana(texto: str) -> list[int]:
    dias = []
    for parte in re.split(r"[,/\s\-e]+", texto):
        key = _norm(parte)
        if key in _DIAS_MAP and _DIAS_MAP[key] not in dias:
            dias.append(_DIAS_MAP[key])
    return sorted(dias)

def _serializar_evento(ev: Evento) -> dict:
    return {
        "id": ev.id,
        "nome_turma": ev.nome_turma,
        "disciplina": ev.disciplina,
        "curso_id": ev.curso_id,
        "oferta_id": ev.oferta_id,
        "carga_horaria_total": ev.carga_horaria_total,
        "horas_semanais": ev.horas_semanais,
        "data_inicio": ev.data_inicio.isoformat() if ev.data_inicio else None,
        "data_fim": ev.data_fim.isoformat() if ev.data_fim else None,
        "dias_semana": ev.dias_semana,
        "horario_inicio": str(ev.horario_inicio)[:5] if ev.horario_inicio else None,
        "horario_fim": str(ev.horario_fim)[:5] if ev.horario_fim else None,
        "modalidade": ev.modalidade,
        "status": ev.status,
        "sala": ev.sala,
        "observacoes": ev.observacoes,
        "professores_preferidos": ev.professores_preferidos,
        "modulo_etapa_inicial": ev.modulo_etapa_inicial,
    }


# ── Schemas ────────────────────────────────────────────────────────────────────

class UCOrdenada(BaseModel):
    uc_id: int
    ordem: int
    professor_preferido_id: Optional[int] = None
    data_inicio: Optional[str] = None
    nao_agendar: bool = False


class GerarRequest(BaseModel):
    ucs: list[UCOrdenada]


class ConfirmarRequest(BaseModel):
    alocacoes: list[dict]
    substituir_futuras: bool = True


class FromOfertaRequest(BaseModel):
    horario_inicio: Optional[str] = None   # "HH:MM" — usa o da oferta se ausente
    horario_fim: Optional[str] = None      # "HH:MM"
    dias_semana: Optional[list[int]] = None
    horas_semanais: Optional[float] = None


class UcAvulsaRequest(BaseModel):
    nome: str
    carga_horaria: int
    modulo_etapa: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _serializar_alocacao(a) -> dict:
    return {
        "uc_id": a.uc_id,
        "uc_nome": a.uc_nome,
        "uc_codigo": a.uc_codigo,
        "etapa": a.etapa,
        "carga_horaria": a.carga_horaria,
        "professor_id": a.professor_id,
        "professor_nome": a.professor_nome,
        "aulas_necessarias": a.aulas_necessarias,
        "datas_aulas": [d.isoformat() for d in a.datas_aulas],
        "justificativa": a.justificativa,
        "alerta": a.alerta,
        "score": a.score,
    }


def _serializar_aula(a: Aula, nome_prof: str | None = None, nome_uc: str | None = None, nome_evento: str | None = None, nome_curso: str | None = None) -> dict:
    return {
        "id": a.id,
        "evento_id": a.evento_id,
        "nome_evento": nome_evento,
        "nome_curso": nome_curso,
        "data": a.data.isoformat() if a.data else None,
        "turno": a.turno,
        "horario_inicio": str(a.horario_inicio)[:5] if a.horario_inicio else None,
        "horario_fim": str(a.horario_fim)[:5] if a.horario_fim else None,
        "unidade_curricular_id": a.unidade_curricular_id,
        "uc_nome": nome_uc,
        "numero_aula": a.numero_aula,
        "subturma": a.subturma,
        "professor_id": a.professor_id,
        "professor_nome": nome_prof,
        "ambiente": a.ambiente or a.sala,
        "etapa": a.etapa,
        "tipo_contrato": a.tipo_contrato,
        "observacoes": a.observacoes,
        "status": a.status,
        "alterada_manualmente": a.alterada_manualmente,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/uc-avulsa/{evento_id}", status_code=201)
async def criar_uc_avulsa(
    evento_id: int,
    body: UcAvulsaRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Cria uma UC avulsa vinculada ao curso do evento.
    Útil quando o próprio curso é a UC (sem UCs cadastradas).
    Se já existir uma UC com o mesmo nome no curso, retorna a existente.
    """
    res_ev = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = res_ev.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    if not evento.curso_id:
        raise HTTPException(status_code=422, detail="Evento não possui curso vinculado. Vincule um curso antes de adicionar UCs.")

    # Verifica se já existe UC com mesmo nome neste curso
    res_uc = await db.execute(
        select(UnidadeCurricular).where(
            and_(
                UnidadeCurricular.curso_id == evento.curso_id,
                UnidadeCurricular.nome == body.nome,
            )
        )
    )
    uc_existente = res_uc.scalars().first()
    if uc_existente:
        return {
            "id": uc_existente.id,
            "codigo_uc": uc_existente.codigo_uc,
            "nome": uc_existente.nome,
            "carga_horaria": uc_existente.carga_horaria,
            "modulo_etapa": uc_existente.modulo_etapa,
            "criada": False,
        }

    # Gera código automático
    res_count = await db.execute(
        select(UnidadeCurricular).where(UnidadeCurricular.curso_id == evento.curso_id)
    )
    qtd = len(res_count.scalars().all())
    codigo = f"UC{evento.curso_id:04d}{qtd + 1:02d}"

    nova_uc = UnidadeCurricular(
        curso_id=evento.curso_id,
        codigo_uc=codigo,
        nome=body.nome,
        carga_horaria=body.carga_horaria,
        modulo_etapa=body.modulo_etapa,
        tipo="Presencial",
    )
    db.add(nova_uc)
    await db.commit()
    await db.refresh(nova_uc)

    return {
        "id": nova_uc.id,
        "codigo_uc": nova_uc.codigo_uc,
        "nome": nova_uc.nome,
        "carga_horaria": nova_uc.carga_horaria,
        "modulo_etapa": nova_uc.modulo_etapa,
        "criada": True,
    }


@router.post("/from-oferta/{oferta_id}", status_code=201)
async def criar_evento_from_oferta(
    oferta_id: int,
    body: FromOfertaRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Cria (ou retorna existente) um Evento de planejamento a partir de uma OfertaCurso.
    Preenche automaticamente: nome, disciplina, curso, datas, horário, carga horária.
    Campos que precisam de ajuste manual podem ser fornecidos no body.
    """
    res_oferta = await db.execute(select(OfertaCurso).where(OfertaCurso.id == oferta_id))
    oferta = res_oferta.scalar_one_or_none()
    if not oferta:
        raise HTTPException(status_code=404, detail="Oferta não encontrada")

    # Verifica se já existe Evento vinculado
    res_ev = await db.execute(select(Evento).where(Evento.oferta_id == oferta_id))
    existente = res_ev.scalar_one_or_none()
    if existente:
        return {"evento": _serializar_evento(existente), "criado": False}

    # --- Mapear campos da oferta ---
    nome_turma = f"{oferta.codigo_evento} – {oferta.nome_curso}"
    disciplina = oferta.nome_curso

    # Datas: prefere execução real, cai em previsão
    data_inicio = oferta.data_inicio
    data_fim = oferta.data_termino
    if not data_inicio or not data_fim:
        raise HTTPException(
            status_code=422,
            detail="A oferta não possui datas de início/fim cadastradas. Informe-as no cadastro da oferta antes de planejar."
        )

    # Horário: prioriza body, depois oferta
    def parse_time(s: str | None) -> time | None:
        if not s:
            return None
        try:
            parts = s.split(":")
            return time(int(parts[0]), int(parts[1]))
        except Exception:
            return None

    horario_inicio = parse_time(body.horario_inicio) or oferta.hora_inicio
    horario_fim = parse_time(body.horario_fim) or oferta.hora_termino
    if not horario_inicio or not horario_fim:
        raise HTTPException(
            status_code=422,
            detail="Horário de início e fim são obrigatórios. Informe no body ou cadastre na oferta."
        )

    # Dias da semana: prioriza body, tenta parsear texto da oferta
    dias_semana: list[int] = body.dias_semana or []
    if not dias_semana and oferta.dias_semana_texto:
        dias_semana = _parsear_dias_semana(oferta.dias_semana_texto)
    if not dias_semana:
        raise HTTPException(
            status_code=422,
            detail="Dias da semana não encontrados. Informe no body ou cadastre em 'dias_semana_texto' na oferta."
        )

    # Horas semanais: body > calculado a partir de horário × nº de dias
    if body.horas_semanais:
        horas_semanais = body.horas_semanais
    else:
        h_inicio = datetime.combine(data_inicio, horario_inicio)
        h_fim = datetime.combine(data_inicio, horario_fim)
        horas_por_dia = max((h_fim - h_inicio).seconds / 3600, 1.0)
        horas_semanais = round(horas_por_dia * len(dias_semana), 1)

    # Modalidade
    mapa_modalidade = {
        "qualificacao profissional": "Presencial",
        "habilitacao tecnica": "Presencial",
        "habilitacao tecnica de nivel medio": "Presencial",
        "fic": "Presencial",
    }
    modalidade_raw = _norm(oferta.modalidade or "")
    modalidade = mapa_modalidade.get(modalidade_raw, "Presencial")

    evento = Evento(
        nome_turma=nome_turma,
        disciplina=disciplina,
        curso_id=oferta.curso_id,
        oferta_id=oferta.id,
        carga_horaria_total=float(oferta.carga_horaria or 0),
        horas_semanais=horas_semanais,
        data_inicio=data_inicio,
        data_fim=data_fim,
        dias_semana=dias_semana,
        horario_inicio=horario_inicio,
        horario_fim=horario_fim,
        modalidade=modalidade,
        status="Planejado",
        sala=None,
    )
    db.add(evento)
    await db.commit()
    await db.refresh(evento)

    return {"evento": _serializar_evento(evento), "criado": True}


@router.post("/importar-historico", status_code=201)
async def importar_historico(
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Importa planilha histórica de agendamentos (aulas travadas como realizadas)."""
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    tamanho_max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    conteudo = await arquivo.read()
    if len(conteudo) > tamanho_max:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máx {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        from app.services.excel_import_cronograma import importar_historico as _imp
        resultado = await _imp(conteudo, db)
        await db.commit()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar: {str(e)}")

    return resultado


@router.get("/cronograma")
async def cronograma_geral(
    evento_id: Optional[int] = None,
    professor_id: Optional[int] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Retorna aulas no formato da planilha com todos os campos enriquecidos."""
    query = select(Aula)
    filters = []
    if evento_id:
        filters.append(Aula.evento_id == evento_id)
    if professor_id:
        filters.append(Aula.professor_id == professor_id)
    if data_inicio:
        filters.append(Aula.data >= data_inicio)
    if data_fim:
        filters.append(Aula.data <= data_fim)
    if status:
        filters.append(Aula.status == status)
    if filters:
        query = query.where(and_(*filters))
    query = query.order_by(Aula.data, Aula.horario_inicio).offset(skip).limit(limit)

    result = await db.execute(query)
    aulas = result.scalars().all()

    # Enriquecer com nomes via lookups em batch
    prof_ids = {a.professor_id for a in aulas if a.professor_id}
    uc_ids = {a.unidade_curricular_id for a in aulas if a.unidade_curricular_id}
    ev_ids = {a.evento_id for a in aulas}

    profs = {}
    if prof_ids:
        res = await db.execute(select(Professor).where(Professor.id.in_(prof_ids)))
        profs = {p.id: p.nome for p in res.scalars().all()}

    ucs = {}
    if uc_ids:
        res = await db.execute(select(UnidadeCurricular).where(UnidadeCurricular.id.in_(uc_ids)))
        ucs = {u.id: u.nome for u in res.scalars().all()}

    eventos: dict[int, Evento] = {}
    cursos: dict[int, str] = {}
    if ev_ids:
        res = await db.execute(select(Evento).where(Evento.id.in_(ev_ids)))
        for e in res.scalars().all():
            eventos[e.id] = e
        curso_ids = {e.curso_id for e in eventos.values() if e.curso_id}
        if curso_ids:
            res2 = await db.execute(select(Curso).where(Curso.id.in_(curso_ids)))
            cursos = {c.id: c.nome for c in res2.scalars().all()}

    rows = []
    for a in aulas:
        ev = eventos.get(a.evento_id)
        nome_evento = ev.nome_turma if ev else None
        nome_curso = cursos.get(ev.curso_id) if ev and ev.curso_id else None
        rows.append(_serializar_aula(
            a,
            nome_prof=profs.get(a.professor_id),
            nome_uc=ucs.get(a.unidade_curricular_id),
            nome_evento=nome_evento,
            nome_curso=nome_curso,
        ))

    return rows


@router.get("/modulos/{evento_id}")
async def listar_modulos_evento(
    evento_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Retorna lista de módulos/etapas distintos das UCs do curso vinculado ao evento."""
    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento or not evento.curso_id:
        return []

    res = await db.execute(
        select(UnidadeCurricular.modulo_etapa)
        .where(
            and_(
                UnidadeCurricular.curso_id == evento.curso_id,
                UnidadeCurricular.modulo_etapa.isnot(None),
                UnidadeCurricular.modulo_etapa != "",
            )
        )
        .distinct()
        .order_by(UnidadeCurricular.modulo_etapa)
    )
    return [row[0] for row in res.fetchall()]


@router.get("/ucs/{evento_id}")
async def listar_ucs_evento(
    evento_id: int,
    modulo: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Retorna UCs do curso vinculado ao evento, opcionalmente filtradas por módulo/etapa."""
    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    if not evento.curso_id:
        return []

    query = (
        select(UnidadeCurricular)
        .where(UnidadeCurricular.curso_id == evento.curso_id)
        .order_by(UnidadeCurricular.modulo_etapa, UnidadeCurricular.sequencia)
    )
    # Filtra pelo módulo solicitado (seleção manual pelo usuário)
    if modulo:
        query = query.where(UnidadeCurricular.modulo_etapa == modulo)
    elif evento.modulo_etapa_inicial:
        # Fallback: filtro histórico por módulo inicial configurado no evento
        res_all = await db.execute(
            select(UnidadeCurricular.modulo_etapa)
            .where(UnidadeCurricular.curso_id == evento.curso_id)
            .distinct()
            .order_by(UnidadeCurricular.modulo_etapa)
        )
        modulos_todos = [r[0] for r in res_all.fetchall() if r[0]]
        try:
            idx = modulos_todos.index(evento.modulo_etapa_inicial)
            modulos_validos = set(modulos_todos[idx:])
            query = query.where(
                UnidadeCurricular.modulo_etapa.in_(modulos_validos)
            )
        except ValueError:
            pass

    res_ucs = await db.execute(query)
    ucs = res_ucs.scalars().all()

    return [
        {
            "id": u.id,
            "codigo_uc": u.codigo_uc,
            "nome": u.nome,
            "tipo": u.tipo,
            "modulo_etapa": u.modulo_etapa,
            "sequencia": u.sequencia,
            "carga_horaria": u.carga_horaria,
        }
        for u in ucs
    ]


@router.get("/candidatos/{evento_id}/{uc_id}")
async def candidatos_uc(
    evento_id: int,
    uc_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Professores candidatos para uma UC com score de adequação."""
    from app.services.planejamento_service import _candidatos_uc
    from app.services.regencia import calcular_regencia_professor

    result = await db.execute(select(Evento).where(Evento.id == evento_id))
    evento = result.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")

    res_uc = await db.execute(select(UnidadeCurricular).where(UnidadeCurricular.id == uc_id))
    uc = res_uc.scalar_one_or_none()
    if not uc:
        raise HTTPException(status_code=404, detail="UC não encontrada")

    res_profs = await db.execute(select(Professor).where(Professor.ativo == True))
    todos = res_profs.scalars().all()
    regencias = {}
    for p in todos:
        regencias[p.id] = await calcular_regencia_professor(p, db)

    preferidos = evento.professores_preferidos or []
    candidatos = await _candidatos_uc(uc, evento, preferidos, regencias, db)

    return [
        {
            "professor_id": c["professor"].id,
            "nome": c["professor"].nome,
            "tipo": c["professor"].tipo,
            "nivel_competencia": c["nivel_competencia"],
            "is_preferido": c["is_preferido"],
            "score": c["score"],
            "percentual_regencia": c["percentual_regencia"],
            "status_regencia": c["status_regencia"],
        }
        for c in candidatos
    ]


@router.post("/gerar/{evento_id}")
async def gerar(
    evento_id: int,
    body: GerarRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Gera proposta de planejamento (não salva). Retorna alocações + análise IA.
    """
    try:
        resultado: PlanejamentoResult = await gerar_planejamento(
            evento_id=evento_id,
            ucs_ordenadas=[u.model_dump() for u in body.ucs],
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro no planejamento: {str(e)}")

    alocacoes_serial = [_serializar_alocacao(a) for a in resultado.alocacoes]

    analise = analisar_proprio(resultado)

    return {
        "evento_id": evento_id,
        "alocacoes": alocacoes_serial,
        "regencia_projetada": resultado.regencia_projetada,
        "conflitos": resultado.conflitos,
        "alertas_regencia": resultado.alertas_regencia,
        "total_aulas": resultado.total_aulas,
        "horas_planejadas": resultado.horas_planejadas,
        "analise": analise,
    }


@router.post("/confirmar/{evento_id}")
async def confirmar(
    evento_id: int,
    body: ConfirmarRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Salva as aulas da proposta no banco."""
    try:
        resultado = await confirmar_planejamento(
            evento_id=evento_id,
            alocacoes=body.alocacoes,
            substituir_futuras=body.substituir_futuras,
            db=db,
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao confirmar: {str(e)}")

    return resultado


@router.get("/regencia-projetada")
async def regencia_projetada(
    evento_id: Optional[int] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Regência dos professores no período.
    Prioridade: datas explícitas > período do evento > semestre atual.
    """
    # Se evento_id fornecido, usa o período do evento
    if evento_id and not data_inicio:
        res_ev = await db.execute(select(Evento).where(Evento.id == evento_id))
        ev = res_ev.scalar_one_or_none()
        if ev and ev.data_inicio and ev.data_fim:
            data_inicio = ev.data_inicio
            data_fim = ev.data_fim

    # Fallback: semestre vigente (ano corrente)
    if not data_inicio:
        from datetime import date as _date
        hoje = _date.today()
        if hoje.month <= 6:
            data_inicio = _date(hoje.year, 1, 1)
            data_fim = _date(hoje.year, 6, 30)
        else:
            data_inicio = _date(hoje.year, 7, 1)
            data_fim = _date(hoje.year, 12, 31)

    res = await db.execute(select(Professor).where(Professor.ativo == True))
    profs = res.scalars().all()

    resultado = []
    for prof in profs:
        reg = await calcular_regencia_professor(prof, db, data_inicio, data_fim)
        resultado.append(reg)

    return sorted(resultado, key=lambda x: x["percentual_regencia"])


# ── Remanejo ───────────────────────────────────────────────────────────────────

class RemanejRequest(BaseModel):
    tipo: str           # "substituicao" | "remarcacao"
    professor_id: Optional[int] = None   # para substituição
    nova_data: Optional[str] = None      # para remarcação (YYYY-MM-DD)


@router.get("/datas-disponiveis/{aula_id}")
async def datas_disponiveis(
    aula_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Retorna datas letivas disponíveis para remarcação de uma aula:
    - Datas futuras do evento que pertencem ao período da aula
    - Excluídas: datas com conflito para o mesmo professor no mesmo horário
    """
    from app.algorithms.constraint_solver import get_datas_letivas, verificar_conflito_professor

    res = await db.execute(select(Aula).where(Aula.id == aula_id))
    aula = res.scalar_one_or_none()
    if not aula:
        raise HTTPException(status_code=404, detail="Aula não encontrada")

    res_ev = await db.execute(select(Evento).where(Evento.id == aula.evento_id))
    evento = res_ev.scalar_one_or_none()
    if not evento:
        raise HTTPException(status_code=404, detail="Evento não encontrado")

    hoje = date.today()
    inicio = max(aula.data + __import__("datetime").timedelta(days=1), hoje)

    todas_letivas = await get_datas_letivas(
        inicio, evento.data_fim, evento.dias_semana or [], db
    )

    disponiveis = []
    for d in todas_letivas:
        conflito = False
        if aula.professor_id:
            conflito = await verificar_conflito_professor(
                aula.professor_id, d, aula.horario_inicio, aula.horario_fim, db
            )
        disponiveis.append({
            "data": d.isoformat(),
            "disponivel": not conflito,
            "conflito": conflito,
        })

    return {"aula_id": aula_id, "datas": disponiveis}


@router.post("/remanejo/{aula_id}")
async def remanejo(
    aula_id: int,
    body: RemanejRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Realiza o remanejo de uma aula.

    tipo=substituicao: troca o professor dessa aula (professor_id obrigatório).
    tipo=remarcacao:   marca original como 'Remarcada', cria nova aula em nova_data
                       e aciona cascade nas aulas seguintes do evento.
    """
    from app.services.replanejamento import alterar_aula_e_replaneja

    res = await db.execute(select(Aula).where(Aula.id == aula_id))
    aula = res.scalar_one_or_none()
    if not aula:
        raise HTTPException(status_code=404, detail="Aula não encontrada")

    if body.tipo == "substituicao":
        if not body.professor_id:
            raise HTTPException(status_code=422, detail="professor_id obrigatório para substituição")
        res_prof = await db.execute(select(Professor).where(Professor.id == body.professor_id))
        prof = res_prof.scalar_one_or_none()
        if not prof:
            raise HTTPException(status_code=404, detail="Professor não encontrado")

        aula.professor_id = body.professor_id
        aula.tipo_contrato = prof.tipo
        aula.alterada_manualmente = True
        await db.flush()
        return {"ok": True, "tipo": "substituicao", "aula_id": aula_id, "professor": prof.nome}

    elif body.tipo == "remarcacao":
        if not body.nova_data:
            raise HTTPException(status_code=422, detail="nova_data obrigatória para remarcação")
        try:
            nova_data = date.fromisoformat(body.nova_data)
        except ValueError:
            raise HTTPException(status_code=422, detail="nova_data inválida (use YYYY-MM-DD)")

        # Marca original como Remarcada e trava
        aula.status = "Remarcada"
        aula.alterada_manualmente = True

        # Cria nova aula na data indicada
        res_ev = await db.execute(select(Evento).where(Evento.id == aula.evento_id))
        evento = res_ev.scalar_one_or_none()

        turno_str = "Manhã"
        if aula.horario_inicio:
            h = aula.horario_inicio.hour
            turno_str = "Tarde" if h >= 12 and h < 18 else ("Noite" if h >= 18 else "Manhã")

        nova_aula = Aula(
            evento_id=aula.evento_id,
            professor_id=aula.professor_id,
            unidade_curricular_id=aula.unidade_curricular_id,
            data=nova_data,
            horario_inicio=aula.horario_inicio,
            horario_fim=aula.horario_fim,
            etapa=aula.etapa,
            turno=turno_str,
            numero_aula=aula.numero_aula,
            tipo_contrato=aula.tipo_contrato,
            status="Agendada",
            tipo="Regular",
            alterada_manualmente=True,
            observacoes=f"Remarcada de {aula.data.isoformat()}",
        )
        db.add(nova_aula)

        # Cascade: replaneja aulas futuras desta UC no evento
        await alterar_aula_e_replaneja(
            aula_id=aula_id,
            alteracoes={"status": "Remarcada"},
            replaneja_futuras=True,
            motivo="Remarcação via remanejo",
            usuario_id=None,
            db=db,
        )

        await db.flush()
        return {
            "ok": True,
            "tipo": "remarcacao",
            "aula_original_id": aula_id,
            "nova_data": nova_data.isoformat(),
        }

    else:
        raise HTTPException(status_code=422, detail="tipo deve ser 'substituicao' ou 'remarcacao'")
