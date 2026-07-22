from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.database import get_db
from app.models.professor import Professor
from app.models.evento import Evento
from app.models.aula import Aula
from app.schemas.dashboard import DashboardData, KPIGlobal, KPIProfessor, KPITurma
from app.services.regencia import calcular_regencia_todos
from app.core.deps import get_current_user

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _dashboard_vazio() -> DashboardData:
    return DashboardData(
        global_kpis=KPIGlobal(
            total_professores_ativos=0, total_turmas_ativas=0,
            total_aulas_semana=0, taxa_regencia_media=0.0,
            professores_criticos=0, professores_alerta=0, professores_ok=0,
            aulas_proxima_semana=0, conflitos_detectados=0,
        ),
        professores=[], turmas=[], alertas=[],
    )


@router.get("/", response_model=DashboardData)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    try:
      hoje = date.today()
    semana_inicio = hoje - timedelta(days=hoje.weekday())
    semana_fim = semana_inicio + timedelta(days=6)
    proxima_semana_inicio = semana_fim + timedelta(days=1)
    proxima_semana_fim = proxima_semana_inicio + timedelta(days=6)

    regencias = await calcular_regencia_todos(db, semana_inicio, semana_fim)

    prof_ok = sum(1 for r in regencias if r["status"] == "OK")
    prof_alerta = sum(1 for r in regencias if r["status"] == "Alerta")
    prof_critico = sum(1 for r in regencias if r["status"] == "Critico")
    taxa_media = sum(r["percentual_regencia"] for r in regencias) / len(regencias) if regencias else 0

    # Aulas desta semana
    res_aulas = await db.execute(
        select(func.count(Aula.id)).where(
            and_(Aula.data >= semana_inicio, Aula.data <= semana_fim, Aula.status != "Cancelada")
        )
    )
    total_aulas_semana = res_aulas.scalar() or 0

    # Aulas próxima semana
    res_prox = await db.execute(
        select(func.count(Aula.id)).where(
            and_(
                Aula.data >= proxima_semana_inicio,
                Aula.data <= proxima_semana_fim,
                Aula.status != "Cancelada",
            )
        )
    )
    aulas_proxima = res_prox.scalar() or 0

    # Total professores ativos
    res_profs = await db.execute(select(func.count(Professor.id)).where(Professor.ativo == True))
    total_profs = res_profs.scalar() or 0

    # Total turmas ativas
    res_ev = await db.execute(select(func.count(Evento.id)).where(Evento.status.in_(["Planejado", "Ativo"])))
    total_turmas = res_ev.scalar() or 0

    global_kpis = KPIGlobal(
        total_professores_ativos=total_profs,
        total_turmas_ativas=total_turmas,
        total_aulas_semana=total_aulas_semana,
        taxa_regencia_media=round(taxa_media, 1),
        professores_criticos=prof_critico,
        professores_alerta=prof_alerta,
        professores_ok=prof_ok,
        aulas_proxima_semana=aulas_proxima,
        conflitos_detectados=0,
    )

    # KPIs por professor
    professores_kpi = []
    for r in regencias:
        res_ag = await db.execute(
            select(func.count(Aula.id)).where(
                and_(Aula.professor_id == r["professor_id"], Aula.status == "Agendada")
            )
        )
        res_re = await db.execute(
            select(func.count(Aula.id)).where(
                and_(Aula.professor_id == r["professor_id"], Aula.status == "Realizada")
            )
        )
        professores_kpi.append(KPIProfessor(
            professor_id=r["professor_id"],
            nome=r["nome"],
            tipo=r["tipo"],
            horas_contratadas=r["horas_contratadas"],
            horas_ministradas_semana=r["horas_ministradas"],
            horas_ministradas_total=r["horas_ministradas"],
            percentual_regencia=r["percentual_regencia"],
            meta_regencia=r["meta_regencia"],
            status_regencia=r["status"],
            total_aulas_agendadas=res_ag.scalar() or 0,
            total_aulas_realizadas=res_re.scalar() or 0,
        ))

    # KPIs por turma
    res_eventos = await db.execute(
        select(Evento).where(Evento.status.in_(["Planejado", "Ativo"]))
    )
    eventos = res_eventos.scalars().all()

    turmas_kpi = []
    for ev in eventos:
        res_total = await db.execute(
            select(func.count(Aula.id)).where(Aula.evento_id == ev.id)
        )
        res_real = await db.execute(
            select(func.count(Aula.id)).where(and_(Aula.evento_id == ev.id, Aula.status == "Realizada"))
        )
        total_aulas = res_total.scalar() or 0
        aulas_realizadas = res_real.scalar() or 0
        progresso = (aulas_realizadas / total_aulas * 100) if total_aulas > 0 else 0

        horas_por_aula = 0
        if ev.horario_inicio and ev.horario_fim:
            from datetime import datetime as dt
            dur = dt.combine(date.today(), ev.horario_fim) - dt.combine(date.today(), ev.horario_inicio)
            horas_por_aula = dur.seconds / 3600

        turmas_kpi.append(KPITurma(
            evento_id=ev.id,
            nome_turma=ev.nome_turma,
            disciplina=ev.disciplina,
            professor_nome=None,
            progresso_percentual=round(progresso, 1),
            aulas_realizadas=aulas_realizadas,
            aulas_totais=total_aulas,
            horas_concluidas=round(aulas_realizadas * horas_por_aula, 1),
            horas_totais=ev.carga_horaria_total,
            status=ev.status,
        ))

    alertas = []
    for r in regencias:
        if r["status"] in ("Critico", "Alerta", "Sobrecarga"):
            alertas.append({
                "tipo": r["status"],
                "mensagem": f"Prof. {r['nome']}: regência em {r['percentual_regencia']:.1f}% (meta: {r['meta_regencia']:.0f}%)",
                "professor_id": r["professor_id"],
            })

        return DashboardData(
            global_kpis=global_kpis,
            professores=professores_kpi,
            turmas=turmas_kpi,
            alertas=alertas,
        )
    except Exception:
        return _dashboard_vazio()
