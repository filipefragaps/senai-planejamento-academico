"""
OR-Tools CP-SAT solver para alocação otimizada de professores.

Resolve o problema de alocação globalmente — em vez do algoritmo greedy
que processa uma UC por vez, o CP-SAT considera todas as UCs simultaneamente
e encontra a atribuição que melhor equilibra regência, habilitação e disponibilidade.

Restrições HARD (não violáveis):
  - Professor deve ter habilitação (atuação) para a UC e curso
  - Professor não pode ter aulas em outras turmas nas mesmas datas/horário

Restrições SOFT (via função objetivo):
  - Preferir professores abaixo da meta de regência (70%)
  - Preferir professores com disponibilidade cadastrada no horário
  - Preferir professores com maior nível de competência na UC
  - Respeitar preferências explícitas do coordenador
"""
import math
from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from app.models.aula import Aula
from app.models.professor import Professor
from app.models.atuacao import Atuacao
from app.models.evento import Evento
from app.models.unidade_curricular import UnidadeCurricular
from app.algorithms.constraint_solver import verificar_disponibilidade_professor
from app.services.regencia import META_REGENCIA_MENSALISTA


# ---------------------------------------------------------------------------
# Ponto de entrada principal
# ---------------------------------------------------------------------------

async def resolver_com_ortools(
    evento: Evento,
    ucs_datas: list[dict],
    # Cada item: {uc: UC, datas: [date], preferidos: [int], nao_agendar: bool}
    todos_profs: list[Professor],
    regencias: dict[int, dict],
    db: AsyncSession,
) -> tuple[dict[int, int | None], str, dict[int, str | None]]:
    """
    Aloca professores a UCs usando CP-SAT.

    Retorna:
      - dict  uc_id → prof_id   (None se UC ficou sem professor)
      - status string: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "TIMEOUT"
      - dict  uc_id → alerta    (None se sem alerta)
    """
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        raise RuntimeError(
            "OR-Tools não está instalado. Adicione 'ortools' ao requirements.txt."
        )

    n_ucs = len(ucs_datas)
    n_profs = len(todos_profs)

    # ── Pré-computar viabilidade ──────────────────────────────────────────────
    # feasible[j][i]  = professor i pode ministrar UC j (habilitado + sem conflito de agenda)
    # disponivel[j][i] = professor i tem disponibilidade cadastrada no horário
    # nivel[j][i]     = nível de competência (1-5)

    feasible   = [[False] * n_profs for _ in range(n_ucs)]
    disponivel = [[False] * n_profs for _ in range(n_ucs)]
    nivel      = [[3]     * n_profs for _ in range(n_ucs)]

    for j, uc_data in enumerate(ucs_datas):
        uc: UnidadeCurricular = uc_data["uc"]
        datas: list[date] = uc_data.get("datas", [])

        for i, prof in enumerate(todos_profs):
            # 1. Habilitação (UC + curso)
            hab, niv = await _checa_habilitacao_e_nivel(prof, uc, db)
            if not hab:
                continue

            nivel[j][i] = niv

            # 2. Disponibilidade (soft — não elimina, só influencia objetivo)
            disp = True
            for dia in (evento.dias_semana or []):
                ok = await verificar_disponibilidade_professor(
                    prof.id, dia, evento.horario_inicio, evento.horario_fim, db
                )
                if not ok:
                    disp = False
                    break
            disponivel[j][i] = disp

            # 3. Conflito de agenda em qualquer das datas planejadas (hard)
            conflito = False
            if datas:
                res = await db.execute(
                    select(Aula.id).where(
                        and_(
                            Aula.professor_id == prof.id,
                            Aula.data.in_(datas),
                            Aula.status != "Cancelada",
                            Aula.horario_inicio < evento.horario_fim,
                            Aula.horario_fim > evento.horario_inicio,
                        )
                    ).limit(1)
                )
                conflito = res.scalar() is not None

            if not conflito:
                feasible[j][i] = True

    # ── Modelo CP-SAT ─────────────────────────────────────────────────────────
    model = cp_model.CpModel()

    x: dict[tuple[int, int], cp_model.IntVar] = {}
    for j in range(n_ucs):
        for i in range(n_profs):
            if feasible[j][i]:
                x[(j, i)] = model.NewBoolVar(f"x_{j}_{i}")

    # Restrição 1: cada UC tem no máximo 1 professor
    for j in range(n_ucs):
        vars_j = [x[(j, i)] for i in range(n_profs) if (j, i) in x]
        if vars_j:
            model.AddAtMostOne(vars_j)

    # Restrição 2: professor com datas sobrepostas entre UCs do mesmo evento
    for i in range(n_profs):
        for j1 in range(n_ucs):
            if not feasible[j1][i]:
                continue
            for j2 in range(j1 + 1, n_ucs):
                if not feasible[j2][i]:
                    continue
                d1 = set(ucs_datas[j1].get("datas", []))
                d2 = set(ucs_datas[j2].get("datas", []))
                if d1 & d2 and (j1, i) in x and (j2, i) in x:
                    model.Add(x[(j1, i)] + x[(j2, i)] <= 1)

    # ── Função objetivo (inteiros 0-100 por variável) ─────────────────────────
    # Pesos: regência 40 | preferido 30 | competência 20 | disponibilidade 10
    obj_terms = []
    for (j, i), var in x.items():
        prof = todos_profs[i]
        reg  = regencias.get(prof.id, {})
        pct  = reg.get("percentual_regencia", 50) / 100
        meta = META_REGENCIA_MENSALISTA if prof.tipo == "Mensalista" else 1.0

        necessidade = max(0, int((1.0 - min(pct, meta) / meta) * 40)) if meta > 0 else 20
        preferidos  = ucs_datas[j].get("preferidos", [])
        bonus_pref  = 30 if prof.id in preferidos else 0
        bonus_comp  = int((nivel[j][i] / 5) * 20)
        bonus_disp  = 10 if disponivel[j][i] else 0

        score = necessidade + bonus_pref + bonus_comp + bonus_disp
        obj_terms.append(score * var)

    if obj_terms:
        model.Maximize(sum(obj_terms))

    # ── Resolver ──────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    solver.parameters.num_search_workers = 4
    code = solver.Solve(model)

    _STATUS = {
        cp_model.OPTIMAL:       "OPTIMAL",
        cp_model.FEASIBLE:      "FEASIBLE",
        cp_model.INFEASIBLE:    "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN:       "TIMEOUT",
    }
    status = _STATUS.get(code, "UNKNOWN")

    # ── Extrair resultado ─────────────────────────────────────────────────────
    result:  dict[int, int | None]   = {}
    alertas: dict[int, str | None]   = {}

    for j, uc_data in enumerate(ucs_datas):
        uc: UnidadeCurricular = uc_data["uc"]
        prof_id = None
        alerta  = None

        if code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for i in range(n_profs):
                if (j, i) in x and solver.Value(x[(j, i)]) == 1:
                    prof_id = todos_profs[i].id
                    if not disponivel[j][i]:
                        alerta = (
                            f"Prof. {todos_profs[i].nome} sem disponibilidade "
                            "cadastrada neste horário — verifique antes de confirmar."
                        )
                    break

        if prof_id is None:
            n_hab = sum(1 for i in range(n_profs) if feasible[j][i])
            if n_hab == 0:
                alerta = "Nenhum professor habilitado e sem conflito de agenda para esta UC."
            else:
                alerta = (
                    f"⚠ Solver não conseguiu alocar ({n_hab} candidato(s) habilitado(s) "
                    "com conflito de agenda) — atribua manualmente."
                )

        result[uc.id]  = prof_id
        alertas[uc.id] = alerta

    return result, status, alertas


# ---------------------------------------------------------------------------
# Análise de impacto: compara proposta com estado atual do banco
# ---------------------------------------------------------------------------

async def calcular_impacto(
    evento_id: int,
    proposta: dict[int, int | None],        # uc_id → prof_id proposto
    todos_profs: list[Professor],
    regencias_antes: dict[int, dict],
    horas_por_uc: dict[int, float],          # uc_id → horas totais
    db: AsyncSession,
) -> dict:
    """
    Compara a proposta OR-Tools com o estado atual do banco.

    Retorna:
      - mudancas: UCs onde o professor muda
      - mantidos: UCs que continuariam com o mesmo professor
      - novos: UCs sem professor hoje que receberiam um
      - sem_professor: UCs que ficariam sem professor
      - regencia_delta: por professor, projeção de ganho/perda de horas
    """
    prof_map = {p.id: p for p in todos_profs}

    # Estado atual do banco (professor atual por UC neste evento)
    res_atual = await db.execute(
        select(Aula.unidade_curricular_id, Aula.professor_id)
        .where(Aula.evento_id == evento_id, Aula.status != "Cancelada")
        .distinct()
    )
    atual: dict[int, int | None] = {}
    for uc_id, prof_id in res_atual.all():
        if uc_id not in atual:
            atual[uc_id] = prof_id

    mudancas      = []
    mantidos      = []
    novos         = []
    sem_professor = []

    horas_delta: dict[int, float] = {}  # prof_id → Δhoras

    for uc_id, novo_prof_id in proposta.items():
        prof_atual_id = atual.get(uc_id)
        horas = horas_por_uc.get(uc_id, 0.0)

        if novo_prof_id is None:
            sem_professor.append(uc_id)
            # Libera horas do professor atual
            if prof_atual_id:
                horas_delta[prof_atual_id] = horas_delta.get(prof_atual_id, 0.0) - horas
        elif prof_atual_id is None:
            novos.append({
                "uc_id": uc_id,
                "professor_proposto_id": novo_prof_id,
                "professor_proposto_nome": prof_map.get(novo_prof_id, {}).nome if novo_prof_id in prof_map else "?",
            })
            horas_delta[novo_prof_id] = horas_delta.get(novo_prof_id, 0.0) + horas
        elif prof_atual_id == novo_prof_id:
            mantidos.append({"uc_id": uc_id, "professor_id": prof_atual_id})
        else:
            mudancas.append({
                "uc_id": uc_id,
                "professor_atual_id":    prof_atual_id,
                "professor_atual_nome":  prof_map[prof_atual_id].nome if prof_atual_id in prof_map else "?",
                "professor_proposto_id": novo_prof_id,
                "professor_proposto_nome": prof_map[novo_prof_id].nome if novo_prof_id in prof_map else "?",
            })
            horas_delta[prof_atual_id] = horas_delta.get(prof_atual_id, 0.0) - horas
            horas_delta[novo_prof_id]  = horas_delta.get(novo_prof_id,  0.0) + horas

    # Projeção de regência após a proposta
    regencia_projecao = []
    for prof_id, delta in horas_delta.items():
        if abs(delta) < 0.01:
            continue
        prof = prof_map.get(prof_id)
        if not prof:
            continue
        reg_antes = regencias_antes.get(prof_id, {})
        pct_antes = reg_antes.get("percentual_regencia", 0.0)
        ch = prof.horas_contratadas or 1.0
        meta = META_REGENCIA_MENSALISTA if prof.tipo == "Mensalista" else 1.0
        # Conversão: delta em horas de aula → impacto percentual de regência
        # (regência = horas_aulas / horas_contratadas_semana; não é trivial sem período exato)
        # Usamos o delta como indicador qualitativo
        regencia_projecao.append({
            "professor_id":   prof_id,
            "professor_nome": prof.nome,
            "tipo":           prof.tipo,
            "regencia_antes": round(pct_antes, 1),
            "horas_delta":    round(delta, 1),
            "direcao":        "sobe" if delta > 0 else "desce",
        })

    # ── Carga global dos professores alocados (TODOS os eventos, não só este) ──
    prof_ids_alocados = [v for v in proposta.values() if v is not None]
    carga_global: list[dict] = []

    if prof_ids_alocados:
        # Aulas em OUTROS eventos agrupadas por professor → evento → UC
        res_cross = await db.execute(
            select(
                Aula.professor_id,
                Aula.evento_id,
                Evento.nome_turma,
                Aula.unidade_curricular_id,
                UnidadeCurricular.nome.label("uc_nome"),
                func.count(Aula.id).label("num_aulas"),
                func.min(Aula.data).label("data_inicio"),
                func.max(Aula.data).label("data_fim"),
            )
            .join(Evento, Aula.evento_id == Evento.id)
            .outerjoin(UnidadeCurricular, Aula.unidade_curricular_id == UnidadeCurricular.id)
            .where(
                and_(
                    Aula.professor_id.in_(prof_ids_alocados),
                    Aula.evento_id != evento_id,
                    Aula.status != "Cancelada",
                )
            )
            .group_by(
                Aula.professor_id,
                Aula.evento_id,
                Evento.nome_turma,
                Aula.unidade_curricular_id,
                UnidadeCurricular.nome,
            )
            .order_by(Aula.professor_id, func.min(Aula.data))
        )
        cross_rows = res_cross.all()

        # Datas individuais para o calendário (máx. 500 por professor para evitar payload gigante)
        res_datas = await db.execute(
            select(Aula.professor_id, Aula.data, Evento.nome_turma)
            .join(Evento, Aula.evento_id == Evento.id)
            .where(
                and_(
                    Aula.professor_id.in_(prof_ids_alocados),
                    Aula.evento_id != evento_id,
                    Aula.status != "Cancelada",
                )
            )
            .order_by(Aula.professor_id, Aula.data)
            .limit(2000)  # segurança: 188 eventos × max ~10 por prof
        )
        datas_por_prof: dict[int, list[dict]] = {}
        for prof_id, data_aula, evt_nome in res_datas.all():
            if prof_id not in datas_por_prof:
                datas_por_prof[prof_id] = []
            datas_por_prof[prof_id].append({
                "data": data_aula.isoformat() if data_aula else None,
                "evento_nome": evt_nome or "",
            })

        # Agrupa por professor
        from collections import defaultdict
        por_prof: dict[int, list] = defaultdict(list)
        for row in cross_rows:
            por_prof[row.professor_id].append({
                "evento_id":   row.evento_id,
                "evento_nome": row.nome_turma or f"Evento {row.evento_id}",
                "uc_nome":     row.uc_nome or "—",
                "num_aulas":   row.num_aulas,
                "data_inicio": row.data_inicio.isoformat() if row.data_inicio else None,
                "data_fim":    row.data_fim.isoformat() if row.data_fim else None,
            })

        for prof_id in prof_ids_alocados:
            prof = prof_map.get(prof_id)
            if not prof:
                continue
            carga_global.append({
                "professor_id":   prof_id,
                "professor_nome": prof.nome,
                "tipo":           prof.tipo,
                "outros_eventos": por_prof.get(prof_id, []),
                "total_aulas_outros_eventos": sum(
                    e["num_aulas"] for e in por_prof.get(prof_id, [])
                ),
                # Datas individuais para o calendário do relatório
                "datas_outros_eventos": datas_por_prof.get(prof_id, []),
            })

    return {
        "mudancas":         mudancas,
        "mantidos_count":   len(mantidos),
        "novos":            novos,
        "sem_professor":    sem_professor,
        "regencia_projecao": sorted(regencia_projecao, key=lambda x: abs(x["horas_delta"]), reverse=True),
        "carga_global":     carga_global,
        "resumo": {
            "total_ucs":     len(proposta),
            "com_professor": sum(1 for v in proposta.values() if v is not None),
            "sem_professor": len(sem_professor),
            "mudancas":      len(mudancas),
            "mantidos":      len(mantidos),
        }
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _checa_habilitacao_e_nivel(
    prof: Professor,
    uc: UnidadeCurricular,
    db: AsyncSession,
) -> tuple[bool, int]:
    """Retorna (habilitado, nivel_competencia)."""
    if uc.curso_id is not None:
        res = await db.execute(
            select(Atuacao).where(
                and_(
                    Atuacao.professor_id == prof.id,
                    Atuacao.curso_id == uc.curso_id,
                )
            )
        )
        atuacoes = res.scalars().all()
        uc_lower = uc.nome.lower()
        match = [
            a for a in atuacoes
            if uc_lower in a.disciplina.lower() or a.disciplina.lower() in uc_lower
        ]
        if not match:
            return False, 3
        return True, max(a.nivel_competencia for a in match)
    else:
        res = await db.execute(
            select(Atuacao).where(
                and_(
                    Atuacao.professor_id == prof.id,
                    Atuacao.disciplina.ilike(f"%{uc.nome[:30]}%"),
                )
            )
        )
        atuacoes = res.scalars().all()
        if not atuacoes:
            return False, 3
        return True, max(a.nivel_competencia for a in atuacoes)
