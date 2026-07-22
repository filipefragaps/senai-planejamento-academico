from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.professor import Professor
from app.models.atuacao import Atuacao
from app.models.disponibilidade import DisponibilidadeDetalhada
from app.schemas.professor import (
    ProfessorCreate, ProfessorUpdate, ProfessorOut, ProfessorComDetalhes, RegenciaInfo
)
from app.services.regencia import calcular_regencia_professor, calcular_regencia_todos
from app.core.deps import get_current_user

router = APIRouter(prefix="/professores", tags=["Professores"])


@router.get("/", response_model=list[ProfessorOut])
async def listar_professores(
    ativo: bool | None = None,
    tipo: str | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(Professor)
    if ativo is not None:
        query = query.where(Professor.ativo == ativo)
    if tipo:
        query = query.where(Professor.tipo == tipo)
    result = await db.execute(query.order_by(Professor.nome))
    return result.scalars().all()


@router.post("/", response_model=ProfessorOut, status_code=201)
async def criar_professor(
    data: ProfessorCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    if data.cpf:
        result = await db.execute(select(Professor).where(Professor.cpf == data.cpf))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="CPF já cadastrado")

    professor = Professor(**data.model_dump())
    db.add(professor)
    await db.commit()
    await db.refresh(professor)
    return professor


@router.get("/regencia", response_model=list[dict])
async def listar_regencias(
    data_inicio: date | None = None,
    data_fim: date | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await calcular_regencia_todos(db, data_inicio, data_fim)


@router.get("/{professor_id}/detalhes")
async def obter_professor_detalhes(
    professor_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Professor com disponibilidades formatadas e atuações agrupadas por curso."""
    result = await db.execute(
        select(Professor)
        .options(
            selectinload(Professor.atuacoes).selectinload(Atuacao.curso),
            selectinload(Professor.disponibilidades),
        )
        .where(Professor.id == professor_id)
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Professor não encontrado")

    DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]

    disponibilidades = [
        {
            "id": d.id,
            "dia_semana": d.dia_semana,
            "dia_nome": DIAS[d.dia_semana] if d.dia_semana < len(DIAS) else str(d.dia_semana),
            "horario_inicio": str(d.horario_inicio)[:5],
            "horario_fim": str(d.horario_fim)[:5],
            "tipo": d.tipo_disponibilidade,
        }
        for d in sorted(p.disponibilidades, key=lambda x: (x.dia_semana, x.horario_inicio))
    ]

    # Agrupa atuações por curso — inclui id da atuação para permitir deleção
    cursos_map: dict = {}
    for a in sorted(p.atuacoes, key=lambda x: (x.curso_id or 0, x.disciplina)):
        key = a.curso_id or 0
        if key not in cursos_map:
            cursos_map[key] = {
                "curso_id": a.curso_id,
                "curso_codigo": a.curso.codigo if a.curso else None,
                "curso_nome": a.curso.nome if a.curso else "Sem curso vinculado",
                "atuacoes": [],
            }
        # evita duplicata de disciplina no mesmo curso
        if not any(x["nome"] == a.disciplina for x in cursos_map[key]["atuacoes"]):
            cursos_map[key]["atuacoes"].append({
                "id": a.id,
                "nome": a.disciplina,
                "modalidade": a.modalidade or "Presencial",
            })

    return {
        "id": p.id,
        "nome": p.nome,
        "email": p.email,
        "telefone": p.telefone,
        "tipo": p.tipo,
        "horas_contratadas": p.horas_contratadas,
        "valor_hora": p.valor_hora,
        "especialidades": p.especialidades,
        "titulacao": p.titulacao,
        "ativo": p.ativo,
        "disponibilidades": disponibilidades,
        "atuacoes_por_curso": list(cursos_map.values()),
    }


@router.get("/{professor_id}", response_model=ProfessorComDetalhes)
async def obter_professor(
    professor_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(Professor)
        .options(selectinload(Professor.atuacoes), selectinload(Professor.disponibilidades))
        .where(Professor.id == professor_id)
    )
    professor = result.scalar_one_or_none()
    if not professor:
        raise HTTPException(status_code=404, detail="Professor não encontrado")
    return professor


@router.put("/{professor_id}", response_model=ProfessorOut)
async def atualizar_professor(
    professor_id: int,
    data: ProfessorUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Professor).where(Professor.id == professor_id))
    professor = result.scalar_one_or_none()
    if not professor:
        raise HTTPException(status_code=404, detail="Professor não encontrado")

    for campo, valor in data.model_dump(exclude_unset=True).items():
        setattr(professor, campo, valor)
    await db.commit()
    await db.refresh(professor)
    return professor


@router.get("/{professor_id}/regencia")
async def regencia_professor(
    professor_id: int,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Professor).where(Professor.id == professor_id))
    professor = result.scalar_one_or_none()
    if not professor:
        raise HTTPException(status_code=404, detail="Professor não encontrado")
    return await calcular_regencia_professor(professor, db, data_inicio, data_fim)


@router.post("/{professor_id}/atuacoes", status_code=201)
async def adicionar_atuacao(
    professor_id: int,
    disciplina: str,
    curso_id: int | None = None,
    modalidade: str = "Habilitação Técnica",
    nivel: int = 3,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Professor).where(Professor.id == professor_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Professor não encontrado")

    atuacao = Atuacao(
        professor_id=professor_id,
        disciplina=disciplina,
        curso_id=curso_id,
        modalidade=modalidade,
        nivel_competencia=nivel,
    )
    db.add(atuacao)
    await db.commit()
    await db.refresh(atuacao)
    return {"id": atuacao.id, "disciplina": atuacao.disciplina, "modalidade": atuacao.modalidade}


@router.patch("/{professor_id}/atuacoes/{atuacao_id}")
async def atualizar_atuacao(
    professor_id: int,
    atuacao_id: int,
    modalidade: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(Atuacao).where(
            Atuacao.id == atuacao_id,
            Atuacao.professor_id == professor_id,
        )
    )
    a = result.scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Atuação não encontrada")
    a.modalidade = modalidade
    await db.commit()
    return {"id": a.id, "modalidade": a.modalidade}


@router.post("/{professor_id}/disponibilidades", status_code=201)
async def adicionar_disponibilidade(
    professor_id: int,
    dia_semana: int,
    horario_inicio: str,
    horario_fim: str,
    tipo: str = "Disponível",
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    from datetime import time as dt_time
    result = await db.execute(select(Professor).where(Professor.id == professor_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Professor não encontrado")

    def parse_time(s: str) -> dt_time:
        h, m = s.split(":")
        return dt_time(int(h), int(m))

    disp = DisponibilidadeDetalhada(
        professor_id=professor_id,
        dia_semana=dia_semana,
        horario_inicio=parse_time(horario_inicio),
        horario_fim=parse_time(horario_fim),
        tipo_disponibilidade=tipo,
    )
    db.add(disp)
    await db.commit()
    await db.refresh(disp)
    return {"id": disp.id}


@router.delete("/{professor_id}/disponibilidades/{disp_id}", status_code=204)
async def remover_disponibilidade(
    professor_id: int,
    disp_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(DisponibilidadeDetalhada).where(
            DisponibilidadeDetalhada.id == disp_id,
            DisponibilidadeDetalhada.professor_id == professor_id,
        )
    )
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Disponibilidade não encontrada")
    await db.delete(d)
    await db.commit()


@router.put("/{professor_id}/disponibilidades/bulk")
async def atualizar_disponibilidade_bulk(
    professor_id: int,
    slots: list[dict],
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Substitui TODAS as disponibilidades do professor pelos slots enviados."""
    from datetime import time as dt_time
    from sqlalchemy import delete as sa_delete

    result = await db.execute(select(Professor).where(Professor.id == professor_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Professor não encontrado")

    await db.execute(
        sa_delete(DisponibilidadeDetalhada).where(
            DisponibilidadeDetalhada.professor_id == professor_id
        )
    )

    def parse_time(s: str) -> dt_time:
        h, m = s.split(":")
        return dt_time(int(h), int(m))

    novos = []
    for s in slots:
        d = DisponibilidadeDetalhada(
            professor_id=professor_id,
            dia_semana=int(s["dia_semana"]),
            horario_inicio=parse_time(s["horario_inicio"]),
            horario_fim=parse_time(s["horario_fim"]),
            tipo_disponibilidade=s.get("tipo", "Disponível"),
        )
        db.add(d)
        novos.append(d)

    await db.commit()
    return {"ok": True, "total": len(novos)}


@router.delete("/{professor_id}/atuacoes/{atuacao_id}", status_code=204)
async def remover_atuacao(
    professor_id: int,
    atuacao_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(Atuacao).where(
            Atuacao.id == atuacao_id,
            Atuacao.professor_id == professor_id,
        )
    )
    a = result.scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Atuação não encontrada")
    await db.delete(a)
    await db.commit()
