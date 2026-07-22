from datetime import date, time, datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from app.database import get_db
from app.models.oferta import OfertaCurso
from app.core.deps import get_current_user
from app.config import settings

router = APIRouter(prefix="/ofertas", tags=["Eventos / Ofertas SENAI"])


class OfertaCreate(BaseModel):
    codigo_evento: str
    nome_curso: str
    pasta: Optional[str] = None
    curso_id: Optional[int] = None
    modalidade: str = "QUALIFICAÇÃO PROFISSIONAL"
    area: Optional[str] = None
    turno: Optional[str] = None
    dias_semana_texto: Optional[str] = None
    cidade: Optional[str] = None
    carga_horaria: int = 0
    hora_inicio: Optional[str] = None
    hora_termino: Optional[str] = None
    data_inicio: Optional[str] = None
    data_termino: Optional[str] = None
    status: str = "NÃO DEFINIDO"
    semestre: int = 1
    vagas: int = 0
    min_para_inicio: int = 0
    parcelas_boleto: Optional[int] = None
    valor_individual: Optional[float] = None
    parcela_com_desconto: Optional[float] = None
    total_por_aluno: Optional[float] = None
    hora_aula: Optional[int] = None
    alunos_matriculados: int = 0
    previsao_inicio: Optional[str] = None
    execucao: Optional[str] = None
    status_cronograma: Optional[str] = None


class OfertaUpdate(BaseModel):
    nome_curso: Optional[str] = None
    modalidade: Optional[str] = None
    area: Optional[str] = None
    pasta: Optional[str] = None
    turno: Optional[str] = None
    dias_semana_texto: Optional[str] = None
    cidade: Optional[str] = None
    carga_horaria: Optional[int] = None
    hora_inicio: Optional[str] = None       # "HH:MM"
    hora_termino: Optional[str] = None      # "HH:MM"
    data_inicio: Optional[str] = None       # "YYYY-MM-DD"
    data_termino: Optional[str] = None      # "YYYY-MM-DD"
    status: Optional[str] = None
    vagas: Optional[int] = None
    min_para_inicio: Optional[int] = None
    parcelas_boleto: Optional[int] = None
    valor_individual: Optional[float] = None
    parcela_com_desconto: Optional[float] = None
    total_por_aluno: Optional[float] = None
    hora_aula: Optional[int] = None
    alunos_matriculados: Optional[int] = None
    previsao_inicio: Optional[str] = None
    execucao: Optional[str] = None
    status_cronograma: Optional[str] = None
    semestre: Optional[int] = None


@router.post("/", status_code=201)
async def criar_oferta(
    dados: OfertaCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Cria um novo evento manualmente."""
    existing = await db.execute(
        select(OfertaCurso).where(OfertaCurso.codigo_evento == dados.codigo_evento)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Código de evento '{dados.codigo_evento}' já existe")

    campos_tempo = {"hora_inicio", "hora_termino"}
    campos_data = {"data_inicio", "data_termino"}
    kwargs: dict = {}

    for campo, valor in dados.model_dump().items():
        if valor is None:
            kwargs[campo] = None
        elif campo in campos_tempo:
            try:
                kwargs[campo] = datetime.strptime(valor, "%H:%M").time() if valor else None
            except (ValueError, TypeError):
                kwargs[campo] = None
        elif campo in campos_data:
            try:
                kwargs[campo] = date.fromisoformat(valor) if valor else None
            except (ValueError, TypeError):
                kwargs[campo] = None
        else:
            kwargs[campo] = valor

    oferta = OfertaCurso(**kwargs)
    db.add(oferta)
    await db.commit()
    await db.refresh(oferta)
    return _serializar(oferta)


@router.post("/importar", status_code=201)
async def importar_ofertas(
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Importa planilha de eventos com abas '1° SEMESTRE' e/ou '2° SEMESTRE'."""
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    tamanho_max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    conteudo = await arquivo.read()
    if len(conteudo) > tamanho_max:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máximo {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        from app.services.excel_import_ofertas import importar_ofertas as _importar
        resultado = await _importar(conteudo, db)
        await db.commit()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar planilha: {str(e)}")

    total = resultado["inseridos"] + resultado["atualizados"]
    return {
        "sucesso": True,
        "inseridos": resultado["inseridos"],
        "atualizados": resultado["atualizados"],
        "mensagem": f"{total} evento(s) processados ({resultado['inseridos']} novos, {resultado['atualizados']} atualizados).",
    }


@router.get("/")
async def listar_ofertas(
    semestre: int | None = None,
    status: str | None = None,
    modalidade: str | None = None,
    area: str | None = None,
    turno: str | None = None,
    busca: str | None = None,
    skip: int = 0,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(OfertaCurso)
    if semestre:
        query = query.where(OfertaCurso.semestre == semestre)
    if status:
        query = query.where(OfertaCurso.status == status)
    if modalidade:
        query = query.where(OfertaCurso.modalidade == modalidade)
    if area:
        query = query.where(OfertaCurso.area == area)
    if turno:
        query = query.where(OfertaCurso.turno == turno)
    if busca:
        b = f"%{busca}%"
        query = query.where(
            or_(OfertaCurso.nome_curso.ilike(b), OfertaCurso.codigo_evento.ilike(b))
        )
    query = query.order_by(OfertaCurso.semestre, OfertaCurso.data_inicio, OfertaCurso.nome_curso)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    ofertas = result.scalars().all()
    return [_serializar(o) for o in ofertas]


@router.get("/stats")
async def estatisticas_ofertas(
    semestre: int | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    base = select(OfertaCurso.status, func.count().label("qtd"))
    if semestre:
        base = base.where(OfertaCurso.semestre == semestre)
    base = base.group_by(OfertaCurso.status)
    result = await db.execute(base)
    por_status = {row.status: row.qtd for row in result}

    total_q = select(func.count()).select_from(OfertaCurso)
    if semestre:
        total_q = total_q.where(OfertaCurso.semestre == semestre)
    total = (await db.execute(total_q)).scalar() or 0

    vagas_q = select(func.sum(OfertaCurso.vagas)).select_from(OfertaCurso)
    if semestre:
        vagas_q = vagas_q.where(OfertaCurso.semestre == semestre)
    vagas = (await db.execute(vagas_q)).scalar() or 0

    matr_q = select(func.sum(OfertaCurso.alunos_matriculados)).select_from(OfertaCurso)
    if semestre:
        matr_q = matr_q.where(OfertaCurso.semestre == semestre)
    matriculados = (await db.execute(matr_q)).scalar() or 0

    # Listas de valores distintos para filtros
    mod_q = await db.execute(select(OfertaCurso.modalidade).distinct().order_by(OfertaCurso.modalidade))
    area_q = await db.execute(select(OfertaCurso.area).distinct().order_by(OfertaCurso.area))
    turno_q = await db.execute(select(OfertaCurso.turno).distinct().order_by(OfertaCurso.turno))

    return {
        "total": total,
        "por_status": por_status,
        "vagas_total": vagas,
        "alunos_matriculados_total": matriculados,
        "modalidades": [r[0] for r in mod_q if r[0]],
        "areas": [r[0] for r in area_q if r[0]],
        "turnos": [r[0] for r in turno_q if r[0]],
    }


@router.patch("/{oferta_id}")
async def atualizar_oferta(
    oferta_id: int,
    dados: OfertaUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(OfertaCurso).where(OfertaCurso.id == oferta_id))
    o = result.scalar_one_or_none()
    if not o:
        raise HTTPException(status_code=404, detail="Oferta não encontrada")

    campos_tempo = {"hora_inicio", "hora_termino"}
    campos_data = {"data_inicio", "data_termino"}

    for campo, valor in dados.model_dump(exclude_none=True).items():
        if campo in campos_tempo:
            try:
                setattr(o, campo, datetime.strptime(valor, "%H:%M").time() if valor else None)
            except ValueError:
                pass
        elif campo in campos_data:
            try:
                setattr(o, campo, date.fromisoformat(valor) if valor else None)
            except ValueError:
                pass
        else:
            setattr(o, campo, valor)

    await db.commit()
    return _serializar(o)


@router.patch("/{oferta_id}/status")
async def atualizar_status(
    oferta_id: int,
    status: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(OfertaCurso).where(OfertaCurso.id == oferta_id))
    o = result.scalar_one_or_none()
    if not o:
        raise HTTPException(status_code=404, detail="Oferta não encontrada")
    o.status = status
    await db.commit()
    return {"id": o.id, "status": o.status}


def _serializar(o: OfertaCurso) -> dict:
    def fmt_time(t):
        return t.strftime("%H:%M") if t else None

    def fmt_date(d):
        return d.isoformat() if d else None

    def fmt_float(f):
        return round(f, 2) if f is not None else None

    return {
        "id": o.id,
        "codigo_evento": o.codigo_evento,
        "semestre": o.semestre,
        "modalidade": o.modalidade,
        "area": o.area,
        "pasta": o.pasta,
        "curso_id": o.curso_id,
        "nome_curso": o.nome_curso,
        "turno": o.turno,
        "dias_semana_texto": o.dias_semana_texto,
        "cidade": o.cidade,
        "carga_horaria": o.carga_horaria,
        "hora_inicio": fmt_time(o.hora_inicio),
        "hora_termino": fmt_time(o.hora_termino),
        "data_inicio": fmt_date(o.data_inicio),
        "data_termino": fmt_date(o.data_termino),
        "status": o.status,
        "vagas": o.vagas,
        "min_para_inicio": o.min_para_inicio,
        "parcelas_boleto": o.parcelas_boleto,
        "valor_individual": fmt_float(o.valor_individual),
        "parcela_com_desconto": fmt_float(o.parcela_com_desconto),
        "total_por_aluno": fmt_float(o.total_por_aluno),
        "hora_aula": o.hora_aula,
        "alunos_matriculados": o.alunos_matriculados,
        "previsao_inicio": o.previsao_inicio,
        "execucao": o.execucao,
        "status_cronograma": o.status_cronograma,
    }
