from datetime import date, datetime, timedelta
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

_MESES_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
_TIPOS_QUADRO = {"Mensalista", "Horista"}

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

        # Inclusão em Folha, PJ e RPA excluídos da média de regência e contagens de status
        _TIPOS_EXCLUIDOS_MEDIA = {"Inclusão em Folha", "PJ", "RPA"}
        regencias_quadro = [r for r in regencias if r["tipo"] not in _TIPOS_EXCLUIDOS_MEDIA]
        prof_ok = sum(1 for r in regencias_quadro if r["status"] == "OK")
        prof_alerta = sum(1 for r in regencias_quadro if r["status"] == "Alerta")
        prof_critico = sum(1 for r in regencias_quadro if r["status"] == "Critico")
        taxa_media = (
            sum(r["percentual_regencia"] for r in regencias_quadro) / len(regencias_quadro)
            if regencias_quadro else 0
        )

        res_aulas = await db.execute(
            select(func.count(Aula.id)).where(
                and_(Aula.data >= semana_inicio, Aula.data <= semana_fim, Aula.status != "Cancelada")
            )
        )
        total_aulas_semana = res_aulas.scalar() or 0

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

        res_profs = await db.execute(
            select(func.count(Professor.id)).where(Professor.ativo == True)
        )
        total_profs = res_profs.scalar() or 0

        res_ev = await db.execute(
            select(func.count(Evento.id)).where(Evento.status.in_(["Planejado", "Ativo"]))
        )
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
                select(func.count(Aula.id)).where(
                    and_(Aula.evento_id == ev.id, Aula.status == "Realizada")
                )
            )
            total_aulas = res_total.scalar() or 0
            aulas_realizadas = res_real.scalar() or 0
            progresso = (aulas_realizadas / total_aulas * 100) if total_aulas > 0 else 0

            horas_por_aula = 0
            if ev.horario_inicio and ev.horario_fim:
                from datetime import datetime as dt
                dur = (
                    dt.combine(date.today(), ev.horario_fim)
                    - dt.combine(date.today(), ev.horario_inicio)
                )
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
                    "mensagem": (
                        f"Prof. {r['nome']}: regência em "
                        f"{r['percentual_regencia']:.1f}% (meta: {r['meta_regencia']:.0f}%)"
                    ),
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


@router.get("/eficiencia")
async def get_eficiencia(
    ano: int | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    CH estimada (eventos Ativo ou Concluído, mês a mês) × CH realizada pelos professores do quadro.
    Quadro = Mensalista + Horista. CH externo = Inclusão em Folha, PJ, RPA e aulas sem professor.
    """
    hoje = date.today()
    ano = ano or hoje.year
    data_inicio = date(ano, 1, 1)
    data_fim = date(ano, 12, 31)

    result = await db.execute(
        select(
            Aula.data,
            Aula.status,
            Evento.horario_inicio,
            Evento.horario_fim,
            Professor.tipo.label("prof_tipo"),
        )
        .join(Evento, Aula.evento_id == Evento.id)
        .outerjoin(Professor, Aula.professor_id == Professor.id)
        .where(
            Evento.status.in_(["Ativo", "Concluído"]),
            Aula.status != "Cancelada",
            Aula.data >= data_inicio,
            Aula.data <= data_fim,
        )
    )
    rows = result.fetchall()

    def _hrs(ini, fim) -> float:
        if not ini or not fim:
            return 1.0
        dur = datetime.combine(date.today(), fim) - datetime.combine(date.today(), ini)
        h = dur.seconds / 3600
        return h if h > 0 else 1.0

    # Inicializa todos os 12 meses com zero
    por_mes: dict[str, dict] = {
        f"{ano}-{i:02d}": {
            "mes": f"{ano}-{i:02d}",
            "label": f"{_MESES_PT[i - 1]}/{str(ano)[2:]}",
            "ch_estimada": 0.0,
            "ch_quadro": 0.0,
            "ch_externos": 0.0,
        }
        for i in range(1, 13)
    }

    for row in rows:
        key = f"{row.data.year}-{row.data.month:02d}"
        if key not in por_mes:
            continue
        hrs = _hrs(row.horario_inicio, row.horario_fim)
        por_mes[key]["ch_estimada"] += hrs
        # Quadro próprio: Mensalista e Horista.
        # CH externo: Inclusão em Folha, PJ, RPA e aulas sem professor alocado.
        if row.prof_tipo in _TIPOS_QUADRO:
            por_mes[key]["ch_quadro"] += hrs
        else:
            por_mes[key]["ch_externos"] += hrs

    resultado = []
    for key in sorted(por_mes):
        m = por_mes[key]
        est = round(m["ch_estimada"], 1)
        q   = round(m["ch_quadro"], 1)
        ext = round(m["ch_externos"], 1)
        nao = round(max(0.0, est - q - ext), 1)
        ef  = round(q / est * 100, 1) if est > 0 else 0.0
        resultado.append({
            "mes": key,
            "label": m["label"],
            "ch_estimada": est,
            "ch_quadro": q,
            "ch_externos": ext,
            "ch_nao_realizada": nao,
            "eficiencia_pct": ef,
        })

    total_est = round(sum(r["ch_estimada"] for r in resultado), 1)
    total_q   = round(sum(r["ch_quadro"]   for r in resultado), 1)
    total_ext = round(sum(r["ch_externos"] for r in resultado), 1)

    return {
        "ano": ano,
        "por_mes": resultado,
        "total": {
            "ch_estimada": total_est,
            "ch_quadro": total_q,
            "ch_externos": total_ext,
            "ch_nao_realizada": round(max(0.0, total_est - total_q - total_ext), 1),
            "eficiencia_pct": round(total_q / total_est * 100, 1) if total_est > 0 else 0.0,
        },
    }
