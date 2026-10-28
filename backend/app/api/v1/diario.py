import re
import unicodedata
from datetime import date, time
from typing import Optional
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, not_, exists
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.diario import DiarioAula
from app.models.aula import Aula
from app.models.professor import Professor
from app.models.evento import Evento
from app.models.oferta import OfertaCurso
from app.models.unidade_curricular import UnidadeCurricular
from app.core.deps import get_current_user, require_admin_ou_coordenador
from app.config import settings
from app.services.excel_import_diario import turno_do_horario

router = APIRouter(prefix="/diario", tags=["Diário de Execução"])


def _norm_nome(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper().strip())


def _minutos(t: time | None) -> int | None:
    return t.hour * 60 + t.minute if t else None


def horas_executadas(registros) -> float:
    """Horas do diário de um professor: aulas simultâneas (duas turmas no mesmo horário) contam uma vez.

    Por dia, os registros cujos horários se sobrepõem formam um bloco; o bloco vale a união dos
    horários. Registro isolado usa a QTDE. HORAS do diário (ou término − início). Registros sem
    horário contam uma vez por dia.
    """
    por_dia: dict[date, list] = {}
    for r in registros:
        por_dia.setdefault(r.data, []).append(r)
    total = 0.0
    for regs in por_dia.values():
        com_horario, sem_horario = [], []
        for r in regs:
            ini, fim = _minutos(r.hora_inicio), _minutos(r.hora_termino)
            (com_horario if ini is not None and fim is not None and fim > ini else sem_horario).append((ini, fim, r))
        com_horario.sort(key=lambda x: x[0])
        blocos: list[list] = []
        for ini, fim, r in com_horario:
            if blocos and ini < blocos[-1][1]:
                blocos[-1][1] = max(blocos[-1][1], fim)
                blocos[-1][2].append(r)
            else:
                blocos.append([ini, fim, [r]])
        for ini, fim, regs_bloco in blocos:
            if len(regs_bloco) == 1 and regs_bloco[0].qtde_horas is not None:
                total += float(regs_bloco[0].qtde_horas)
            else:
                total += (fim - ini) / 60.0
        # Sem horário: um único registro por dia (mesmo critério de antes)
        sem = [r for _, _, r in sem_horario]
        if sem:
            total += max((float(r.qtde_horas or 0) for r in sem), default=0.0)
    return total


@router.post("/importar", status_code=201)
async def importar_diario(
    arquivo: UploadFile = File(...),
    origem: Literal["presencial", "ead"] = Query("presencial"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_coordenador),
):
    """Importa planilha do diário de execução. Substitui os registros anteriores da mesma origem
    (presencial = sistema de gestão acadêmica; ead = diário EaD dos sábados)."""
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    tamanho_max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    conteudo = await arquivo.read()
    if len(conteudo) > tamanho_max:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máximo {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        from app.services.excel_import_diario import importar_diario as _importar
        resultado = await _importar(conteudo, db, origem)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar planilha: {e}")

    rotulo = "Diário EaD" if origem == "ead" else "Diário"
    return {
        "sucesso": True,
        "origem": origem,
        "inseridos": resultado["inseridos"],
        "erros": resultado["erros"],
        "mensagem": f"{rotulo}: {resultado['inseridos']} registro(s) importados ({resultado['erros']} ignorados por data inválida).",
    }


@router.get("/stats")
async def stats_diario(
    data_inicio: date,
    data_fim: date,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Horas executadas por professor no período (aulas simultâneas contam uma vez, igual ao modal)."""
    from collections import defaultdict
    res = await db.execute(
        select(
            DiarioAula.professor_id,
            DiarioAula.data,
            DiarioAula.hora_inicio,
            DiarioAula.hora_termino,
            DiarioAula.qtde_horas,
        )
        .where(
            DiarioAula.professor_id.isnot(None),
            DiarioAula.data >= data_inicio,
            DiarioAula.data <= data_fim,
        )
        .order_by(DiarioAula.professor_id, DiarioAula.data, DiarioAula.hora_inicio)
    )
    por_prof: dict[int, list] = defaultdict(list)
    for row in res.all():
        por_prof[row.professor_id].append(row)
    return {str(pid): round(horas_executadas(regs), 2) for pid, regs in por_prof.items()}


@router.get("/info")
async def info_diario(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Retorna informações sobre os dados importados (data da última importação e total de registros),
    no geral e só do diário EaD."""
    total = (await db.execute(select(func.count()).select_from(DiarioAula))).scalar() or 0
    ultimo = (await db.execute(select(func.max(DiarioAula.importado_em)))).scalar()
    data_min = (await db.execute(select(func.min(DiarioAula.data)))).scalar()
    data_max = (await db.execute(select(func.max(DiarioAula.data)))).scalar()
    ead_total, ead_ultimo = (await db.execute(
        select(func.count(), func.max(DiarioAula.importado_em)).where(DiarioAula.origem == "ead")
    )).one()
    return {
        "total": total,
        "importado_em": ultimo.isoformat() if ultimo else None,
        "data_inicio": data_min.isoformat() if data_min else None,
        "data_fim": data_max.isoformat() if data_max else None,
        "ead": {"total": ead_total or 0, "importado_em": ead_ultimo.isoformat() if ead_ultimo else None},
    }


@router.get("/comparacao/{professor_id}")
async def comparacao(
    professor_id: int,
    data_inicio: date,
    data_fim: date,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Compara aulas planejadas (sistema) com as registradas no diário de execução
    para um professor em um período.
    """
    # Buscar nome do professor para cruzar com o campo instrutor do diário
    res_prof = await db.execute(select(Professor.nome).where(Professor.id == professor_id))
    prof_nome = res_prof.scalar_one_or_none()
    if not prof_nome:
        raise HTTPException(status_code=404, detail="Professor não encontrado")

    # Aulas planejadas no período
    res_aulas = await db.execute(
        select(Aula).where(
            Aula.professor_id == professor_id,
            Aula.data >= data_inicio,
            Aula.data <= data_fim,
        ).order_by(Aula.data, Aula.horario_inicio)
    )
    aulas_planejadas = res_aulas.scalars().all()

    # Batch-fetch UC names for aulas that have unidade_curricular_id linked
    uc_ids = {a.unidade_curricular_id for a in aulas_planejadas if a.unidade_curricular_id}
    uc_nome_map: dict[int, str] = {}
    if uc_ids:
        res_uc = await db.execute(
            select(UnidadeCurricular.id, UnidadeCurricular.nome).where(UnidadeCurricular.id.in_(uc_ids))
        )
        uc_nome_map = {row.id: row.nome for row in res_uc.all()}

    # Batch-fetch event info (codigo + nome_curso) for all planned aulas
    evento_ids = {a.evento_id for a in aulas_planejadas if a.evento_id}
    evento_info: dict[int, dict] = {}
    if evento_ids:
        res_ev = await db.execute(
            select(Evento.id, Evento.nome_turma, Evento.oferta_id).where(Evento.id.in_(evento_ids))
        )
        ev_rows = {row.id: row for row in res_ev.all()}

        # Path 1: lookup by oferta_id
        oferta_ids = {row.oferta_id for row in ev_rows.values() if row.oferta_id}
        oferta_map: dict[int, dict] = {}
        if oferta_ids:
            res_of = await db.execute(
                select(OfertaCurso.id, OfertaCurso.codigo_evento, OfertaCurso.nome_curso)
                .where(OfertaCurso.id.in_(oferta_ids))
            )
            for row in res_of.all():
                oferta_map[row.id] = {"codigo": row.codigo_evento, "nome_curso": row.nome_curso}

        # Path 2: fallback lookup by codigo_evento for eventos without oferta_id
        codigos_sem_oferta: dict[str, int] = {}  # codigo → ev_id
        for ev_id, ev_row in ev_rows.items():
            if not ev_row.oferta_id:
                nm = (ev_row.nome_turma or "").strip()
                codigo = nm.split()[0] if nm else None
                if codigo:
                    codigos_sem_oferta[codigo] = ev_id

        oferta_by_codigo: dict[str, dict] = {}
        if codigos_sem_oferta:
            res_of2 = await db.execute(
                select(OfertaCurso.codigo_evento, OfertaCurso.nome_curso)
                .where(OfertaCurso.codigo_evento.in_(codigos_sem_oferta.keys()))
            )
            for row in res_of2.all():
                oferta_by_codigo[row.codigo_evento] = {"codigo": row.codigo_evento, "nome_curso": row.nome_curso}

        for ev_id, ev_row in ev_rows.items():
            if ev_row.oferta_id and ev_row.oferta_id in oferta_map:
                of = oferta_map[ev_row.oferta_id]
                evento_info[ev_id] = {"codigo": of["codigo"], "nome_curso": of["nome_curso"]}
            else:
                nm = (ev_row.nome_turma or "").strip()
                codigo = nm.split()[0] if nm else None
                of2 = oferta_by_codigo.get(codigo) if codigo else None
                evento_info[ev_id] = {
                    "codigo": codigo,
                    "nome_curso": of2["nome_curso"] if of2 else None,
                }

    # Registros do diário no período — filtra por professor_id (se vinculado) OU nome normalizado
    norm_prof = _norm_nome(prof_nome)
    res_diario = await db.execute(
        select(DiarioAula).where(
            DiarioAula.data >= data_inicio,
            DiarioAula.data <= data_fim,
        ).order_by(DiarioAula.data, DiarioAula.hora_inicio)
    )
    all_diario = res_diario.scalars().all()
    diario_entries = [
        d for d in all_diario
        if d.professor_id == professor_id or _norm_nome(d.instrutor or "") == norm_prof
    ]

    # Indexar diário por data para lookup flexível de horário
    diario_por_data: dict[date, list[DiarioAula]] = {}
    for d in diario_entries:
        diario_por_data.setdefault(d.data, []).append(d)

    def _min(t: time | None) -> int:
        return t.hour * 60 + t.minute if t else -999

    matched_diario_ids: set[int] = set()

    def _match_diario(aula_data: date, aula_inicio: time | None, codigo: str | None) -> DiarioAula | None:
        """Registro do diário da aula: horário até 60 min de diferença (EaD: mesmo turno); com duas
        turmas no mesmo horário, prefere o do mesmo evento e não reaproveita registro já vinculado."""
        aula_m = _min(aula_inicio)
        turno = turno_do_horario(aula_inicio)
        candidatos = [d for d in diario_por_data.get(aula_data, [])
                      if abs(_min(d.hora_inicio) - aula_m) <= 60
                      or (d.origem == "ead" and turno and turno_do_horario(d.hora_inicio) == turno)]
        if not candidatos:
            return None
        return min(candidatos, key=lambda d: (
            (d.evento_codigo or "") != (codigo or ""),  # mesmo evento primeiro
            d.id in matched_diario_ids,                  # registro ainda livre
            abs(_min(d.hora_inicio) - aula_m),           # horário mais próximo
        ))

    planejadas_out = []
    for a in aulas_planejadas:
        ev = evento_info.get(a.evento_id, {}) if a.evento_id else {}
        diario_match = _match_diario(a.data, a.horario_inicio, ev.get("codigo"))
        if diario_match:
            matched_diario_ids.add(diario_match.id)

        planejadas_out.append({
            "aula_id": a.id,
            "data": a.data.isoformat(),
            "horario_inicio": str(a.horario_inicio)[:5] if a.horario_inicio else None,
            "horario_fim": str(a.horario_fim)[:5] if a.horario_fim else None,
            "evento_id": a.evento_id,
            "evento_codigo": ev.get("codigo"),
            "evento_nome": ev.get("nome_curso"),
            "uc_nome": a.uc_nome_original or uc_nome_map.get(a.unidade_curricular_id or 0),
            "status": a.status,
            "diario": _serializar_diario(diario_match) if diario_match else None,
        })

    somente_diario = [
        _serializar_diario(d)
        for d in diario_entries
        if d.id not in matched_diario_ids
    ]

    return {
        "professor_nome": prof_nome,
        "planejadas": planejadas_out,
        "somente_diario": somente_diario,
        "horas_executadas": round(horas_executadas(diario_entries), 2),
    }


def _serializar_diario(d: DiarioAula) -> dict:
    return {
        "id": d.id,
        "instrutor": d.instrutor,
        "evento_codigo": d.evento_codigo,
        "evento_nome": d.evento_nome,
        "componente_codigo": d.componente_codigo,
        "componente_nome": d.componente_nome,
        "data": d.data.isoformat(),
        "hora_inicio": str(d.hora_inicio)[:5] if d.hora_inicio else None,
        "hora_termino": str(d.hora_termino)[:5] if d.hora_termino else None,
        "qtde_horas": d.qtde_horas,
        "ambiente": d.ambiente,
        "conteudo": d.conteudo,
        "origem": d.origem or "presencial",
        "importado_em": d.importado_em.isoformat() if d.importado_em else None,
    }


@router.get("/sem-diario")
async def aulas_sem_diario(
    professor_id: Optional[int] = Query(default=None),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Lista todas as aulas (todos os tipos de professor) sem diário vinculado."""
    from app.models.pagamento import PagamentoAula

    q = (
        select(Aula)
        .join(Professor, Aula.professor_id == Professor.id)
        .join(Evento, Aula.evento_id == Evento.id)
        .options(
            selectinload(Aula.professor),
            selectinload(Aula.evento),
            selectinload(Aula.unidade_curricular),
        )
        .where(Aula.status.notin_(["Cancelada", "Remarcada"]))
        .where(not_(exists().where(DiarioAula.aula_id == Aula.id)))
    )
    if professor_id:
        q = q.where(Aula.professor_id == professor_id)
    if data_inicio:
        q = q.where(Aula.data >= data_inicio)
    if data_fim:
        q = q.where(Aula.data <= data_fim)
    q = q.order_by(Aula.data.asc())

    result = await db.execute(q)
    aulas = result.scalars().all()

    # UC names para aulas planejadas (sem uc_nome_original)
    uc_ids = {a.unidade_curricular_id for a in aulas if a.unidade_curricular_id}
    uc_nome_map: dict[int, str] = {}
    if uc_ids:
        res_uc = await db.execute(
            select(UnidadeCurricular.id, UnidadeCurricular.nome).where(UnidadeCurricular.id.in_(uc_ids))
        )
        uc_nome_map = {row.id: row.nome for row in res_uc.all()}

    # Status de pagamento
    aula_ids = [a.id for a in aulas]
    pag_map: dict[int, str] = {}
    if aula_ids:
        pag_res = await db.execute(
            select(PagamentoAula.aula_id, PagamentoAula.status).where(
                PagamentoAula.aula_id.in_(aula_ids),
                PagamentoAula.status.in_(["encaminhado", "pago"]),
            )
        )
        pag_map = {row.aula_id: row.status for row in pag_res.all()}

    def _h(ini: time, fim: time) -> float:
        mins = (fim.hour * 60 + fim.minute) - (ini.hour * 60 + ini.minute)
        return round(max(mins, 0) / 60, 2)

    return [
        {
            "id": a.id,
            "data": a.data.isoformat(),
            "horario_inicio": a.horario_inicio.strftime("%H:%M"),
            "horario_fim": a.horario_fim.strftime("%H:%M"),
            "horas": _h(a.horario_inicio, a.horario_fim),
            "professor_id": a.professor_id,
            "professor_nome": a.professor.nome if a.professor else "—",
            "professor_tipo": a.professor.tipo if a.professor else "—",
            "evento_id": a.evento_id,
            "evento_nome": a.evento.nome_turma if a.evento else "—",
            "uc_nome": a.uc_nome_original or uc_nome_map.get(a.unidade_curricular_id or 0) or "—",
            "status_pagamento": pag_map.get(a.id, "pendente"),
        }
        for a in aulas
    ]
