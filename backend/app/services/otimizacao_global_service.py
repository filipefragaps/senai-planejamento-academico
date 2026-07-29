"""
Otimização Global de Regência via PuLP (LP Inteiro Binário).

Premissas:
- Apenas UCs sem nenhuma aula "Realizada" são candidatas a reatribuição
- Prioridade de professor: Mensalista > Horista > RPA/PJ
- RPA/PJ só entram se incluir_rpa_pj=True (ou sem outros candidatos)
- Objetivo: minimizar déficit de regência dos Mensalistas em relação à meta de 70%
"""

import unicodedata
from datetime import date, datetime, timedelta
from typing import Optional

import pulp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.professor import Professor
from app.models.atuacao import Atuacao
from app.models.aula import Aula
from app.models.evento import Evento
from app.models.unidade_curricular import UnidadeCurricular
from app.models.disponibilidade import DisponibilidadeDetalhada

META_MENSALISTA = 0.70
_CUSTO_HORISTA = 5
_CUSTO_RPA_PJ = 500


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()


def _horas_por_aula(evento: Evento) -> float:
    if not evento.horario_inicio or not evento.horario_fim:
        return 1.0
    base = date.today()
    inicio = datetime.combine(base, evento.horario_inicio)
    fim = datetime.combine(base, evento.horario_fim)
    return max(0.5, (fim - inicio).total_seconds() / 3600)


def _tipo_custo(tipo: str) -> int:
    if tipo == "Mensalista":
        return 0
    if tipo == "Horista":
        return _CUSTO_HORISTA
    return _CUSTO_RPA_PJ


def _is_rpa_pj(tipo: str) -> bool:
    return tipo not in ("Mensalista", "Horista")


def _eventos_conflitam(ev_a: Evento, ev_b: Evento) -> bool:
    """True se os dois eventos compartilham ao menos um slot de dia+horário."""
    dias_a = set(ev_a.dias_semana or [])
    dias_b = set(ev_b.dias_semana or [])
    if not (dias_a & dias_b):
        return False
    h_a_ini = ev_a.horario_inicio
    h_a_fim = ev_a.horario_fim
    h_b_ini = ev_b.horario_inicio
    h_b_fim = ev_b.horario_fim
    if not all([h_a_ini, h_a_fim, h_b_ini, h_b_fim]):
        return False
    return h_a_ini < h_b_fim and h_b_ini < h_a_fim


def _resultado_vazio(mensagem: str) -> dict:
    return {
        "status": "sem_resultado",
        "mensagem": mensagem,
        "remanejamentos": [],
        "sem_candidatos": [],
        "impacto_professores": [],
        "resumo": {
            "total_ucs_livres": 0,
            "total_remanejamentos": 0,
            "mensalistas_na_meta_antes": 0,
            "mensalistas_na_meta_depois": 0,
        },
    }


async def analisar_otimizacao_global(
    db: AsyncSession,
    incluir_rpa_pj: bool = False,
    hoje: Optional[date] = None,
) -> dict:
    """
    Analisa e sugere remanejamentos de professores para maximizar regência.
    Retorna o resultado sem salvar nada no banco.
    """
    if hoje is None:
        hoje = date.today()

    # ── 1. Eventos ativos ──────────────────────────────────────────────────────
    res_ev = await db.execute(
        select(Evento).where(
            Evento.status.in_(["Planejado", "Ativo", "Em Andamento"])
        )
    )
    todos_eventos: dict[int, Evento] = {ev.id: ev for ev in res_ev.scalars().all()}

    if not todos_eventos:
        return _resultado_vazio("Nenhum evento ativo encontrado.")

    # ── 2. Aulas agrupadas por (evento_id, uc_id) ──────────────────────────────
    res_aulas = await db.execute(
        select(Aula).where(
            and_(
                Aula.evento_id.in_(todos_eventos.keys()),
                Aula.unidade_curricular_id.isnot(None),
                Aula.status.notin_(["Cancelada"]),
            )
        )
    )
    todas_aulas = res_aulas.scalars().all()

    uc_aulas: dict[tuple[int, int], list[Aula]] = {}
    for aula in todas_aulas:
        key = (aula.evento_id, aula.unidade_curricular_id)
        uc_aulas.setdefault(key, []).append(aula)

    # ── 3. Separar UCs iniciadas x livres ─────────────────────────────────────
    ucs_livres: list[dict] = []
    horas_fixas: dict[int, float] = {}  # prof_id → horas comprometidas (não tocáveis)

    for (ev_id, uc_id), aulas in uc_aulas.items():
        iniciada = any(a.status == "Realizada" for a in aulas)
        aulas_futuras = [a for a in aulas if a.data >= hoje]
        ev = todos_eventos[ev_id]
        horas_uc = len(aulas_futuras) * _horas_por_aula(ev)

        # Professor atual = mais frequente entre as aulas futuras
        profs_futuros = [a.professor_id for a in aulas_futuras if a.professor_id]
        prof_atual = max(set(profs_futuros), key=profs_futuros.count) if profs_futuros else None

        if iniciada:
            # UC iniciada: horas vão para o "fixo" do professor atual
            if prof_atual is not None:
                horas_fixas[prof_atual] = horas_fixas.get(prof_atual, 0.0) + horas_uc
            # Também soma as realizadas (passado)
            for a in aulas:
                if a.status == "Realizada" and a.professor_id:
                    horas_fixas[a.professor_id] = (
                        horas_fixas.get(a.professor_id, 0.0) + _horas_por_aula(ev)
                    )
        else:
            if horas_uc > 0:
                ucs_livres.append({
                    "key": (ev_id, uc_id),
                    "evento_id": ev_id,
                    "uc_id": uc_id,
                    "prof_atual_id": prof_atual,
                    "horas": horas_uc,
                    "num_aulas": len(aulas_futuras),
                })

    if not ucs_livres:
        return _resultado_vazio("Todas as UCs já foram iniciadas. Não há o que realocar.")

    # ── 4. Professores e atuações ──────────────────────────────────────────────
    res_profs = await db.execute(select(Professor).where(Professor.ativo == True))
    todos_profs = res_profs.scalars().all()

    profs = [p for p in todos_profs if not _is_rpa_pj(p.tipo) or incluir_rpa_pj]
    if not profs:
        return _resultado_vazio("Nenhum professor Mensalista ou Horista ativo encontrado.")
    profs_map: dict[int, Professor] = {p.id: p for p in profs}
    prof_ids_list = list(profs_map.keys())

    res_at = await db.execute(
        select(Atuacao).where(Atuacao.professor_id.in_(prof_ids_list))
    )
    atuacoes_por_prof: dict[int, list[Atuacao]] = {}
    for at in res_at.scalars().all():
        atuacoes_por_prof.setdefault(at.professor_id, []).append(at)

    # ── 5. Disponibilidades ────────────────────────────────────────────────────
    res_disp = await db.execute(
        select(DisponibilidadeDetalhada).where(
            and_(
                DisponibilidadeDetalhada.professor_id.in_(prof_ids_list),
                DisponibilidadeDetalhada.tipo_disponibilidade.in_(["Disponível", "Preferencial"]),
            )
        )
    )
    disps_por_prof: dict[int, list[DisponibilidadeDetalhada]] = {}
    for d in res_disp.scalars().all():
        disps_por_prof.setdefault(d.professor_id, []).append(d)

    # ── 5a. Carregar nomes das UCs ─────────────────────────────────────────────
    uc_ids_set = {item["uc_id"] for item in ucs_livres}
    res_ucs = await db.execute(
        select(UnidadeCurricular).where(UnidadeCurricular.id.in_(uc_ids_set))
    )
    ucs_map: dict[int, UnidadeCurricular] = {u.id: u for u in res_ucs.scalars().all()}

    # ── 6. Funções de compatibilidade ─────────────────────────────────────────
    def professor_pode(prof_id: int, uc: UnidadeCurricular) -> bool:
        for at in atuacoes_por_prof.get(prof_id, []):
            if at.curso_id and uc.curso_id and at.curso_id == uc.curso_id:
                return True
            nome_uc = _norm(uc.nome)
            nome_disc = _norm(at.disciplina)
            if nome_disc in nome_uc or nome_uc in nome_disc:
                return True
        return False

    def professor_disponivel(prof_id: int, ev: Evento) -> bool:
        disps = disps_por_prof.get(prof_id)
        if not disps:
            return True  # sem cadastro = assume disponível
        for dia in ev.dias_semana or []:
            ok = any(
                d.dia_semana == dia
                and d.horario_inicio <= ev.horario_inicio
                and d.horario_fim >= ev.horario_fim
                for d in disps
            )
            if not ok:
                return False
        return True

    # ── 7. Período e metas ─────────────────────────────────────────────────────
    data_fim_periodo = max(
        (ev.data_fim for ev in todos_eventos.values() if ev.data_fim),
        default=hoje + timedelta(days=180),
    )
    semanas_periodo = max(1.0, (data_fim_periodo - hoje).days / 7)

    # Inicializa horas_fixas para todos os professores
    for p in profs:
        if p.id not in horas_fixas:
            horas_fixas[p.id] = 0.0

    # ── 8. Montar modelo PuLP ──────────────────────────────────────────────────
    prob = pulp.LpProblem("otimizacao_regencia_global", pulp.LpMinimize)

    # Variáveis: x[(prof_id, ev_id, uc_id)] = 1 se professor leciona esta UC
    x: dict[tuple[int, int, int], pulp.LpVariable] = {}
    for item in ucs_livres:
        ev_id = item["evento_id"]
        uc_id = item["uc_id"]
        ev = todos_eventos[ev_id]
        uc = ucs_map.get(uc_id)
        if not uc:
            continue
        for p in profs:
            if professor_pode(p.id, uc) and professor_disponivel(p.id, ev):
                key = (p.id, ev_id, uc_id)
                x[key] = pulp.LpVariable(f"x_{p.id}_{ev_id}_{uc_id}", cat="Binary")

    # Guard: sem variáveis → nada a otimizar
    if not x:
        return _resultado_vazio("Nenhum professor com atuação e disponibilidade compatíveis com as UCs disponíveis.")

    # Constraint 1: cada UC livre recebe exatamente 1 professor
    sem_candidatos: list[dict] = []
    for item in ucs_livres:
        ev_id, uc_id = item["evento_id"], item["uc_id"]
        ev = todos_eventos[ev_id]
        uc = ucs_map.get(uc_id)
        candidatos = [x[(p.id, ev_id, uc_id)] for p in profs if (p.id, ev_id, uc_id) in x]
        if candidatos:
            prob += pulp.lpSum(candidatos) == 1
        else:
            sem_candidatos.append({
                "evento_id": ev_id,
                "evento_nome": ev.nome_turma,
                "uc_id": uc_id,
                "uc_nome": uc.nome if uc else f"UC {uc_id}",
                "motivo": "Nenhum professor com atuação e disponibilidade compatíveis",
            })

    # Constraint 2: sem double-booking entre eventos conflitantes
    # Pré-cria indicadores y[(prof_id, ev_id)] = 1 se professor leciona alguma UC neste evento.
    # Feito fora do loop de pares para evitar nomes duplicados de variáveis.
    y_vars: dict[tuple[int, int], pulp.LpVariable] = {}
    for p in profs:
        for ev_id in todos_eventos.keys():
            ucs_ev = [
                x[(p.id, ev_id, it["uc_id"])]
                for it in ucs_livres
                if it["evento_id"] == ev_id and (p.id, ev_id, it["uc_id"]) in x
            ]
            if ucs_ev:
                yvar = pulp.LpVariable(f"in_{p.id}_{ev_id}", cat="Binary")
                y_vars[(p.id, ev_id)] = yvar
                M = len(ucs_ev)
                # y=1 se professor está em pelo menos 1 UC do evento
                prob += pulp.lpSum(ucs_ev) <= M * yvar
                prob += yvar <= pulp.lpSum(ucs_ev)

    ev_list = list(todos_eventos.values())
    for i, ev_a in enumerate(ev_list):
        for ev_b in ev_list[i + 1 :]:
            if not _eventos_conflitam(ev_a, ev_b):
                continue
            for p in profs:
                ya = y_vars.get((p.id, ev_a.id))
                yb = y_vars.get((p.id, ev_b.id))
                if ya is not None and yb is not None:
                    prob += ya + yb <= 1

    # ── 9. Função objetivo ─────────────────────────────────────────────────────
    deficit_terms = []
    tipo_penalty_terms = []

    for p in profs:
        # Horas atribuídas pela otimização
        horas_otimizadas = pulp.lpSum(
            x[(p.id, it["evento_id"], it["uc_id"])] * it["horas"]
            for it in ucs_livres
            if (p.id, it["evento_id"], it["uc_id"]) in x
        )
        horas_totais = horas_fixas[p.id] + horas_otimizadas

        if p.tipo == "Mensalista":
            meta_horas = p.horas_contratadas * semanas_periodo * META_MENSALISTA
            deficit_var = pulp.LpVariable(f"def_{p.id}", lowBound=0)
            prob += deficit_var >= meta_horas - horas_totais
            deficit_terms.append(deficit_var)

        custo = _tipo_custo(p.tipo)
        if custo > 0:
            for it in ucs_livres:
                key = (p.id, it["evento_id"], it["uc_id"])
                if key in x:
                    tipo_penalty_terms.append(custo * x[key])

    # Prioridade: minimizar déficit (peso 1000) + penalidade por tipo
    prob += 1000 * pulp.lpSum(deficit_terms) + pulp.lpSum(tipo_penalty_terms)

    # ── 10. Resolver ───────────────────────────────────────────────────────────
    import logging
    try:
        solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=30)
        status = prob.solve(solver)
    except Exception as e:
        logging.warning(f"[otimizacao] CBC falhou ({e}), tentando solver padrão")
        try:
            status = prob.solve()
        except Exception as e2:
            return _resultado_vazio(f"Solver indisponível: {e2}")

    status_str = pulp.LpStatus.get(status, "Desconhecido")
    if status_str not in ("Optimal", "Feasible"):
        return _resultado_vazio(f"Solver não encontrou solução ({status_str}).")

    # ── 11. Extrair remanejamentos (apenas onde professor MUDA) ───────────────
    def _val(key: tuple) -> float:
        """Retorna o valor da variável binária ou 0 se a chave não existir."""
        var = x.get(key)
        if var is None:
            return 0.0
        v = pulp.value(var)
        return v if v is not None else 0.0

    remanejamentos: list[dict] = []
    for item in ucs_livres:
        ev_id, uc_id = item["evento_id"], item["uc_id"]
        prof_novo_id: int | None = None
        for p in profs:
            if _val((p.id, ev_id, uc_id)) > 0.5:
                prof_novo_id = p.id
                break

        if prof_novo_id is None or prof_novo_id == item["prof_atual_id"]:
            continue

        ev = todos_eventos[ev_id]
        uc = ucs_map.get(uc_id)
        prof_antigo = profs_map.get(item["prof_atual_id"]) if item["prof_atual_id"] else None
        prof_novo = profs_map[prof_novo_id]

        remanejamentos.append({
            "evento_id": ev_id,
            "evento_nome": ev.nome_turma,
            "uc_id": uc_id,
            "uc_nome": uc.nome if uc else f"UC {uc_id}",
            "num_aulas": item["num_aulas"],
            "horas": round(item["horas"], 1),
            "prof_atual_id": item["prof_atual_id"],
            "prof_atual_nome": prof_antigo.nome if prof_antigo else "(sem professor)",
            "prof_atual_tipo": prof_antigo.tipo if prof_antigo else None,
            "prof_novo_id": prof_novo_id,
            "prof_novo_nome": prof_novo.nome,
            "prof_novo_tipo": prof_novo.tipo,
        })

    # ── 12. Impacto por professor (Mensalistas) ────────────────────────────────
    impacto: list[dict] = []
    for p in profs:
        if p.tipo != "Mensalista":
            continue
        meta_horas = p.horas_contratadas * semanas_periodo * META_MENSALISTA

        # Horas antes: fixas + horas nas UCs livres com o professor atual
        horas_antes = horas_fixas[p.id] + sum(
            it["horas"] for it in ucs_livres if it["prof_atual_id"] == p.id
        )
        # Horas depois: fixas + horas atribuídas pelo solver
        horas_depois = horas_fixas[p.id] + sum(
            it["horas"]
            for it in ucs_livres
            if _val((p.id, it["evento_id"], it["uc_id"])) > 0.5
        )

        pct_antes = round(horas_antes / meta_horas * 100, 1) if meta_horas else 0
        pct_depois = round(horas_depois / meta_horas * 100, 1) if meta_horas else 0

        if abs(pct_depois - pct_antes) >= 0.5 or pct_antes < 100 or pct_depois < 100:
            impacto.append({
                "professor_id": p.id,
                "nome": p.nome,
                "tipo": p.tipo,
                "pct_antes": pct_antes,
                "pct_depois": pct_depois,
                "horas_antes": round(horas_antes, 1),
                "horas_depois": round(horas_depois, 1),
                "meta_pct": 70,
            })

    impacto.sort(key=lambda r: r["pct_depois"] - r["pct_antes"], reverse=True)

    return {
        "status": "ok",
        "mensagem": None,
        "remanejamentos": remanejamentos,
        "sem_candidatos": sem_candidatos,
        "impacto_professores": impacto,
        "resumo": {
            "total_ucs_livres": len(ucs_livres),
            "total_remanejamentos": len(remanejamentos),
            "mensalistas_na_meta_antes": sum(
                1 for r in impacto if r["pct_antes"] >= 70
            ),
            "mensalistas_na_meta_depois": sum(
                1 for r in impacto if r["pct_depois"] >= 70
            ),
        },
    }


async def confirmar_otimizacao_global(
    db: AsyncSession,
    remanejamentos: list[dict],
) -> dict:
    """
    Aplica os remanejamentos aprovados: atualiza professor_id nas aulas futuras.
    Não marca as aulas como alterada_manualmente (é uma decisão algorítmica).
    """
    hoje = date.today()
    total_aulas = 0

    for rem in remanejamentos:
        ev_id = rem["evento_id"]
        uc_id = rem["uc_id"]
        novo_prof_id = rem["prof_novo_id"]

        res_prof = await db.execute(select(Professor).where(Professor.id == novo_prof_id))
        prof = res_prof.scalar_one_or_none()
        if not prof:
            continue

        res_aulas = await db.execute(
            select(Aula).where(
                and_(
                    Aula.evento_id == ev_id,
                    Aula.unidade_curricular_id == uc_id,
                    Aula.data >= hoje,
                    Aula.status.notin_(["Cancelada", "Realizada"]),
                )
            )
        )
        for aula in res_aulas.scalars().all():
            aula.professor_id = novo_prof_id
            aula.tipo_contrato = prof.tipo
            total_aulas += 1

    await db.commit()
    return {
        "ok": True,
        "remanejamentos_aplicados": len(remanejamentos),
        "aulas_atualizadas": total_aulas,
    }
