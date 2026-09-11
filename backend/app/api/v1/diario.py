from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.diario import DiarioAula
from app.models.aula import Aula
from app.models.professor import Professor
from app.models.evento import Evento
from app.models.oferta import OfertaCurso
from app.core.deps import get_current_user
from app.config import settings

router = APIRouter(prefix="/diario", tags=["Diário de Execução"])


@router.post("/importar", status_code=201)
async def importar_diario(
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Importa planilha do diário de execução. Substitui todos os registros anteriores."""
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    tamanho_max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    conteudo = await arquivo.read()
    if len(conteudo) > tamanho_max:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máximo {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        from app.services.excel_import_diario import importar_diario as _importar
        resultado = await _importar(conteudo, db)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar planilha: {e}")

    return {
        "sucesso": True,
        "inseridos": resultado["inseridos"],
        "erros": resultado["erros"],
        "mensagem": f"{resultado['inseridos']} registro(s) importados ({resultado['erros']} ignorados por data inválida).",
    }


@router.get("/info")
async def info_diario(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Retorna informações sobre os dados importados (data da última importação e total de registros)."""
    total = (await db.execute(select(func.count()).select_from(DiarioAula))).scalar() or 0
    ultimo = (await db.execute(select(func.max(DiarioAula.importado_em)))).scalar()
    data_min = (await db.execute(select(func.min(DiarioAula.data)))).scalar()
    data_max = (await db.execute(select(func.max(DiarioAula.data)))).scalar()
    return {
        "total": total,
        "importado_em": ultimo.isoformat() if ultimo else None,
        "data_inicio": data_min.isoformat() if data_min else None,
        "data_fim": data_max.isoformat() if data_max else None,
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

    # Batch-fetch event info (codigo + nome_curso) for all planned aulas
    evento_ids = {a.evento_id for a in aulas_planejadas if a.evento_id}
    evento_info: dict[int, dict] = {}
    if evento_ids:
        res_ev = await db.execute(
            select(Evento.id, Evento.nome_turma, Evento.oferta_id).where(Evento.id.in_(evento_ids))
        )
        ev_rows = {row.id: row for row in res_ev.all()}

        oferta_ids = {row.oferta_id for row in ev_rows.values() if row.oferta_id}
        oferta_map: dict[int, dict] = {}
        if oferta_ids:
            res_of = await db.execute(
                select(OfertaCurso.id, OfertaCurso.codigo_evento, OfertaCurso.nome_curso)
                .where(OfertaCurso.id.in_(oferta_ids))
            )
            for row in res_of.all():
                oferta_map[row.id] = {"codigo": row.codigo_evento, "nome_curso": row.nome_curso}

        for ev_id, ev_row in ev_rows.items():
            if ev_row.oferta_id and ev_row.oferta_id in oferta_map:
                of = oferta_map[ev_row.oferta_id]
                evento_info[ev_id] = {"codigo": of["codigo"], "nome_curso": of["nome_curso"]}
            else:
                # Fallback: extract code from nome_turma (first token)
                nm = (ev_row.nome_turma or "").strip()
                evento_info[ev_id] = {"codigo": nm.split()[0] if nm else None, "nome_curso": None}

    # Registros do diário para este professor no período
    res_diario = await db.execute(
        select(DiarioAula).where(
            DiarioAula.instrutor.ilike(prof_nome),
            DiarioAula.data >= data_inicio,
            DiarioAula.data <= data_fim,
        ).order_by(DiarioAula.data, DiarioAula.hora_inicio)
    )
    diario_entries = res_diario.scalars().all()

    # Indexar diário por (data, hora_inicio) para lookup rápido
    diario_idx: dict[tuple, list[DiarioAula]] = {}
    for d in diario_entries:
        chave = (d.data, d.hora_inicio)
        diario_idx.setdefault(chave, []).append(d)

    planejadas_out = []
    for a in aulas_planejadas:
        chave = (a.data, a.horario_inicio)
        matches = diario_idx.get(chave, [])
        diario_match = matches[0] if matches else None

        ev = evento_info.get(a.evento_id, {}) if a.evento_id else {}

        planejadas_out.append({
            "aula_id": a.id,
            "data": a.data.isoformat(),
            "horario_inicio": str(a.horario_inicio)[:5] if a.horario_inicio else None,
            "horario_fim": str(a.horario_fim)[:5] if a.horario_fim else None,
            "evento_id": a.evento_id,
            "evento_codigo": ev.get("codigo"),
            "evento_nome": ev.get("nome_curso"),
            "uc_nome": a.uc_nome_original,
            "status": a.status,
            "diario": _serializar_diario(diario_match) if diario_match else None,
        })

    # Registros do diário sem correspondência no planejado
    matched_diario_ids = {
        d.id
        for entries in diario_idx.values()
        for d in entries
        if any(a.data == d.data and a.horario_inicio == d.hora_inicio for a in aulas_planejadas)
    }
    somente_diario = [
        _serializar_diario(d)
        for d in diario_entries
        if d.id not in matched_diario_ids
    ]

    return {
        "professor_nome": prof_nome,
        "planejadas": planejadas_out,
        "somente_diario": somente_diario,
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
        "importado_em": d.importado_em.isoformat() if d.importado_em else None,
    }
