"""
Planejamento em lote: vários eventos de uma vez (escolhidos pelo usuário).

1. Datas: cada evento gera suas datas com a mesma regra do planejamento por evento
   (gerar_planejamento), sem escolher professor.
2. Professores: um único modelo CP-SAT escolhe o professor de TODAS as UCs juntas, para
   que a escolha de uma turma não deixe outra sem docente no final.
3. Gravação: o frontend confirma evento por evento com o /planejamento/confirmar existente.

Regras do modelo:
  - um professor por UC (ou nenhum, se não houver quem possa);
  - só professores habilitados (atuação), ou o professor travado pelo usuário;
  - sem choque: mesmo professor, mesma data, horário sobreposto — entre as UCs do lote e
    com as aulas já gravadas de outras turmas;
  - carga semanal: aulas do lote + aulas já gravadas ≤ horas contratadas por semana.
Objetivo (em ordem): cobrir o máximo de aulas → Mensalista antes de Horista, RPA/PJ por
último → professor disponível no horário → maior score (necessidade de regência,
preferência, competência).
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, time

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.aula import Aula
from app.models.curso import Curso
from app.models.evento import Evento
from app.models.professor import Professor
from app.models.unidade_curricular import UnidadeCurricular
from app.services.planejamento_service import _candidatos_uc, _horas_aula, gerar_planejamento
from app.services.regencia import calcular_regencia_professor

_PESO_COBERTURA = 100_000   # por aula coberta: domina todo o resto
_CUSTO_TIPO = {"Mensalista": 0, "Horista": 300}
_CUSTO_RPA_PJ = 3_000
_CUSTO_INDISPONIVEL = 1_000


def _custo_tipo(tipo: str | None) -> int:
    return _CUSTO_TIPO.get(tipo or "", _CUSTO_RPA_PJ)


def _minutos(t: time | None) -> int:
    return t.hour * 60 + t.minute if t else 0


def _sobrepoe(a_ini: time | None, a_fim: time | None, b_ini: time | None, b_fim: time | None) -> bool:
    if not all([a_ini, a_fim, b_ini, b_fim]):
        return False
    return a_ini < b_fim and b_ini < a_fim


def _semana(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return (iso[0], iso[1])


def ordenar_etapas(etapas: list[str]) -> list[str]:
    from app.api.v1.planejamento import _ordem_etapa
    return sorted(etapas, key=_ordem_etapa)


def montar_ucs_evento(evento: Evento, ucs: list[UnidadeCurricular], data_inicio: str | None,
                      modo_superior: bool) -> list[dict]:
    """Mesma montagem da tela de planejamento (ucsParaPlanejar)."""
    ucs = sorted(ucs, key=lambda u: (u.sequencia if u.sequencia is not None else 999, u.id))
    if not modo_superior:
        return [
            {"uc_id": u.id, "ordem": i + 1, "data_inicio": data_inicio if i == 0 and data_inicio else None}
            for i, u in enumerate(ucs)
        ]
    # Ensino Superior: um dia fixo por UC; com mais UCs que dias, estende com sexta e sábado
    pool = list(evento.dias_semana or [])
    if len(ucs) > len(pool):
        for d in (4, 5):
            if d not in pool:
                pool.append(d)
            if len(pool) >= len(ucs):
                break
    itens = []
    for i, u in enumerate(ucs):
        itens.append({
            "uc_id": u.id, "ordem": i + 1, "data_inicio": data_inicio or None,
            "dias_semana": [pool[i % len(pool)]] if pool else None,
        })
    return itens


async def eventos_para_lote(db: AsyncSession, curso_id: int | None = None) -> dict:
    """Eventos ativos (de um curso ou de todos), com o curso resolvido, as etapas já
    planejadas e a próxima sugerida."""
    from sqlalchemy import func
    from app.api.v1.planejamento import _resolver_curso_id

    filtros = [or_(Evento.status.is_(None), Evento.status.notin_(["Concluído", "Cancelado"]))]
    if curso_id:
        filtros.append(or_(Evento.curso_id == curso_id, Evento.curso_id.is_(None)))
    res = await db.execute(select(Evento).where(and_(*filtros)))
    eventos: list[tuple[Evento, int | None]] = []
    for ev in res.scalars().all():
        cid = ev.curso_id or await _resolver_curso_id(ev, ev.id, db)
        if curso_id and cid != curso_id:
            continue
        eventos.append((ev, cid))

    curso_ids = {cid for _, cid in eventos if cid}
    cursos: dict[int, Curso] = {}
    etapa_de: dict[int, str] = {}
    etapas_curso: dict[int, list[str]] = defaultdict(list)
    if curso_ids:
        for c in (await db.execute(select(Curso).where(Curso.id.in_(curso_ids)))).scalars().all():
            cursos[c.id] = c
        res_ucs = await db.execute(
            select(UnidadeCurricular.id, UnidadeCurricular.curso_id, UnidadeCurricular.modulo_etapa)
            .where(UnidadeCurricular.curso_id.in_(curso_ids))
        )
        brutas: dict[int, set[str]] = defaultdict(set)
        for uc_id, cid, et in res_ucs.all():
            etapa_de[uc_id] = et or ""
            if et:
                brutas[cid].add(et)
        for cid, ets in brutas.items():
            etapas_curso[cid] = ordenar_etapas(sorted(ets))

    # Aulas já gravadas por evento/UC (uma consulta só)
    planejado: dict[int, dict[str, dict]] = defaultdict(dict)
    ids = [ev.id for ev, _ in eventos]
    if ids:
        res_a = await db.execute(
            select(Aula.evento_id, Aula.unidade_curricular_id, func.count(), func.max(Aula.data))
            .where(and_(Aula.evento_id.in_(ids), Aula.status != "Cancelada"))
            .group_by(Aula.evento_id, Aula.unidade_curricular_id)
        )
        for ev_id, uc_id, n, ultima in res_a.all():
            et = etapa_de.get(uc_id)
            if not et:
                continue
            info = planejado[ev_id].setdefault(et, {"aulas": 0, "ultima": None})
            info["aulas"] += n
            if ultima and (info["ultima"] is None or ultima > info["ultima"]):
                info["ultima"] = ultima

    saida = []
    for ev, cid in sorted(eventos, key=lambda t: (t[0].data_inicio or date.max, t[0].nome_turma or "")):
        etapas = etapas_curso.get(cid, []) if cid else []
        por_etapa = planejado.get(ev.id, {})
        planejadas = [
            {"etapa": et, "aulas": por_etapa[et]["aulas"],
             "ultima_aula": por_etapa[et]["ultima"].isoformat() if por_etapa[et]["ultima"] else None}
            for et in etapas if et in por_etapa
        ]
        proxima = next((et for et in etapas if et not in por_etapa), etapas[0] if etapas else None)
        curso = cursos.get(cid) if cid else None
        saida.append({
            "id": ev.id,
            "nome_turma": ev.nome_turma,
            "disciplina": ev.disciplina,
            "tipo_modalidade": ev.tipo_modalidade,
            "status": ev.status,
            "curso_id": cid,
            "curso_nome": curso.nome if curso else None,
            "curso_codigo": curso.codigo if curso else None,
            "etapas": etapas,
            "data_inicio": ev.data_inicio.isoformat() if ev.data_inicio else None,
            "data_fim": ev.data_fim.isoformat() if ev.data_fim else None,
            "dias_semana": ev.dias_semana or [],
            "horario_inicio": str(ev.horario_inicio)[:5] if ev.horario_inicio else None,
            "horario_fim": str(ev.horario_fim)[:5] if ev.horario_fim else None,
            "etapas_planejadas": planejadas,
            "etapa_sugerida": proxima,
        })
    return {"etapas": etapas_curso.get(curso_id, []) if curso_id else [], "eventos": saida}


async def eventos_do_curso(db: AsyncSession, curso_id: int) -> dict:
    return await eventos_para_lote(db, curso_id)


async def preview_lote(db: AsyncSession, curso_id: int | None, eventos_cfg: list[dict], travas: list[dict]) -> dict:
    try:
        from ortools.sat.python import cp_model
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("OR-Tools não instalado no servidor.") from e

    res_profs = await db.execute(select(Professor).where(Professor.ativo == True))  # noqa: E712
    todos_profs = list(res_profs.scalars().all())
    prof_map = {p.id: p for p in todos_profs}
    regencias = {p.id: await calcular_regencia_professor(p, db) for p in todos_profs}

    from app.api.v1.planejamento import _resolver_curso_id

    ucs_por_curso: dict[int, list[UnidadeCurricular]] = {}
    trava_de = {(t["evento_id"], t["uc_id"]): t["professor_id"] for t in travas if t.get("professor_id")}

    # ── 1. Datas de cada evento (mesma regra do planejamento por evento) ─────────
    itens: list[dict] = []   # uma entrada por (evento, UC) com aulas
    erros: list[dict] = []
    eventos_out: dict[int, dict] = {}
    for cfg in eventos_cfg:
        ev = (await db.execute(select(Evento).where(Evento.id == cfg["evento_id"]))).scalar_one_or_none()
        if not ev:
            erros.append({"evento_id": cfg["evento_id"], "erro": "Evento não encontrado"})
            continue
        cid = ev.curso_id or await _resolver_curso_id(ev, ev.id, db) or curso_id
        if not cid:
            erros.append({"evento_id": ev.id, "erro": "Evento sem curso cadastrado"})
            continue
        if cid not in ucs_por_curso:
            res_ucs = await db.execute(select(UnidadeCurricular).where(UnidadeCurricular.curso_id == cid))
            ucs_por_curso[cid] = list(res_ucs.scalars().all())
        modulo = cfg.get("modulo")
        ucs_ev = [u for u in ucs_por_curso[cid] if not modulo or (u.modulo_etapa or "") == modulo]
        if not ucs_ev:
            erros.append({"evento_id": ev.id, "erro": f"Nenhuma UC na etapa {modulo or '(todas)'}"})
            continue
        try:
            r = await gerar_planejamento(
                evento_id=ev.id,
                ucs_ordenadas=montar_ucs_evento(ev, ucs_ev, cfg.get("data_inicio"), cfg.get("modo_superior", False)),
                db=db,
                modo_superior=cfg.get("modo_superior", False),
                clipar_semestre=cfg.get("clipar_semestre", False),
                escolher_professor=False,
                regencias_cache=regencias,
            )
        except ValueError as e:
            erros.append({"evento_id": ev.id, "erro": str(e)})
            continue
        eventos_out[ev.id] = {"evento_id": ev.id, "nome_turma": ev.nome_turma, "modulo": modulo, "alocacoes": []}
        uc_map = {u.id: u for u in ucs_ev}
        for a in r.alocacoes:
            itens.append({
                "evento": ev, "uc": uc_map[a.uc_id], "aloc": a,
                "datas": list(a.datas_aulas), "horas_aula": _horas_aula(ev),
            })

    if not itens:
        return {"eventos": list(eventos_out.values()), "erros": erros, "sem_professor": [],
                "professores": [], "resumo": {"ucs": 0, "cobertas": 0, "aulas": 0, "aulas_cobertas": 0},
                "status": "SEM_ITENS"}

    # ── 2. Candidatos (habilitação + disponibilidade), cacheados por UC e horário ─
    cache_cand: dict[tuple, list[dict]] = {}
    for it in itens:
        ev, uc = it["evento"], it["uc"]
        chave = (uc.id, tuple(sorted(ev.dias_semana or [])), ev.horario_inicio, ev.horario_fim,
                 tuple(sorted(ev.professores_preferidos or [])))
        if chave not in cache_cand:
            cache_cand[chave] = await _candidatos_uc(uc, ev, ev.professores_preferidos or [], regencias, db)
        it["candidatos"] = {c["professor"].id: c for c in cache_cand[chave]}
        travado = trava_de.get((ev.id, uc.id))
        it["travado"] = travado
        if travado and travado not in it["candidatos"] and travado in prof_map:
            p = prof_map[travado]
            it["candidatos"][travado] = {
                "professor": p, "nivel_competencia": 3, "is_preferido": False, "disponivel": True,
                "score": 0.0, "percentual_regencia": regencias.get(p.id, {}).get("percentual_regencia", 0),
                "status_regencia": regencias.get(p.id, {}).get("status", "N/A"), "manual": True,
            }

    # ── 3. Aulas já gravadas (outras turmas) que ocupam os candidatos ────────────
    todas_datas = [d for it in itens for d in it["datas"]]
    ids_cand = {pid for it in itens for pid in it["candidatos"]}
    substituidas = {(it["evento"].id, it["uc"].id) for it in itens}
    ocupado: dict[int, list[tuple[date, time, time]]] = defaultdict(list)
    horas_existentes: dict[tuple[int, tuple[int, int]], float] = defaultdict(float)
    if todas_datas and ids_cand:
        res_aulas = await db.execute(
            select(Aula).where(
                and_(
                    Aula.professor_id.in_(ids_cand),
                    Aula.status != "Cancelada",
                    Aula.data >= min(todas_datas),
                    Aula.data <= max(todas_datas),
                )
            )
        )
        for a in res_aulas.scalars().all():
            if (a.evento_id, a.unidade_curricular_id) in substituidas:
                continue  # será substituída por este planejamento
            ocupado[a.professor_id].append((a.data, a.horario_inicio, a.horario_fim))
            if a.horario_inicio and a.horario_fim:
                h = (_minutos(a.horario_fim) - _minutos(a.horario_inicio)) / 60
                horas_existentes[(a.professor_id, _semana(a.data))] += max(0.0, h)

    def choca_com_gravadas(pid: int, it: dict) -> bool:
        ev = it["evento"]
        datas = set(it["datas"])
        return any(
            d in datas and _sobrepoe(hi, hf, ev.horario_inicio, ev.horario_fim)
            for d, hi, hf in ocupado.get(pid, [])
        )

    # ── 4. Modelo CP-SAT ─────────────────────────────────────────────────────────
    model = cp_model.CpModel()
    x: dict[tuple[int, int], object] = {}
    motivo_base: dict[int, str] = {}
    for i, it in enumerate(itens):
        if not it["datas"]:
            motivo_base[i] = "Sem datas letivas no período."
            continue
        if not it["candidatos"]:
            motivo_base[i] = "Nenhum professor habilitado para esta UC (cadastre a atuação do professor)."
            continue
        livres = [pid for pid in it["candidatos"] if pid == it["travado"] or not choca_com_gravadas(pid, it)]
        if not livres:
            motivo_base[i] = (f"Os {len(it['candidatos'])} professor(es) habilitado(s) já têm aula neste "
                              "horário em outras turmas.")
            continue
        for pid in livres:
            x[(i, pid)] = model.NewBoolVar(f"x_{i}_{pid}")
        model.Add(sum(x[(i, pid)] for pid in livres) <= 1)
        if it["travado"] in livres:
            model.Add(x[(i, it["travado"])] == 1)

    # Sem choque entre UCs do lote (turmas diferentes, mesma data, horário sobreposto)
    por_data: dict[date, list[int]] = defaultdict(list)
    for i, it in enumerate(itens):
        for d in it["datas"]:
            por_data[d].append(i)
    pares: set[tuple[int, int]] = set()
    for idxs in por_data.values():
        for a_pos in range(len(idxs)):
            for b_pos in range(a_pos + 1, len(idxs)):
                a, b = idxs[a_pos], idxs[b_pos]
                ea, eb = itens[a]["evento"], itens[b]["evento"]
                if ea.id != eb.id and _sobrepoe(ea.horario_inicio, ea.horario_fim, eb.horario_inicio, eb.horario_fim):
                    pares.add((min(a, b), max(a, b)))
    for a, b in pares:
        for pid in itens[a]["candidatos"]:
            if (a, pid) in x and (b, pid) in x:
                model.Add(x[(a, pid)] + x[(b, pid)] <= 1)

    # Carga semanal contratada (em minutos, para ficar inteiro)
    por_prof_semana: dict[tuple[int, tuple[int, int]], list[tuple[int, int]]] = defaultdict(list)
    for (i, pid) in x:
        it = itens[i]
        cont: dict[tuple[int, int], int] = defaultdict(int)
        for d in it["datas"]:
            cont[_semana(d)] += 1
        for sem, n in cont.items():
            por_prof_semana[(pid, sem)].append((i, round(n * it["horas_aula"] * 60)))
    for (pid, sem), termos in por_prof_semana.items():
        cap = prof_map[pid].horas_contratadas or 0
        if cap <= 0:
            continue
        livre = max(0, round((cap - horas_existentes.get((pid, sem), 0.0)) * 60))
        model.Add(sum(m * x[(i, pid)] for i, m in termos) <= livre)

    # Objetivo
    termos_obj = []
    for (i, pid), var in x.items():
        it = itens[i]
        c = it["candidatos"][pid]
        n = len(it["datas"])
        p = prof_map[pid]
        valor = (_PESO_COBERTURA
                 - _custo_tipo(p.tipo)
                 - (0 if c.get("disponivel", True) else _CUSTO_INDISPONIVEL)
                 + round(c["score"] * 100))
        termos_obj.append(n * valor * var)
    model.Maximize(sum(termos_obj))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 45.0
    solver.parameters.num_workers = 8
    status = solver.Solve(model)
    status_nome = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise ValueError(
            "Não foi possível montar uma proposta com as travas escolhidas "
            "(algum professor travado não cabe na carga ou tem choque). Remova uma trava e tente de novo."
        )

    escolhido: dict[int, int] = {i: pid for (i, pid), var in x.items() if solver.Value(var)}

    # ── 5. Monta a resposta ──────────────────────────────────────────────────────
    sem_professor = []
    horas_prof: dict[int, float] = defaultdict(float)
    ucs_prof: dict[int, int] = defaultdict(int)
    semana_prof: dict[tuple[int, tuple[int, int]], float] = defaultdict(float)
    aulas_total = aulas_cobertas = 0
    for i, it in enumerate(itens):
        ev, uc, a = it["evento"], it["uc"], it["aloc"]
        pid = escolhido.get(i)
        p = prof_map.get(pid) if pid else None
        n = len(it["datas"])
        aulas_total += n
        if p:
            aulas_cobertas += n
            horas_prof[pid] += n * it["horas_aula"]
            ucs_prof[pid] += 1
            for d in it["datas"]:
                semana_prof[(pid, _semana(d))] += it["horas_aula"]
            c = it["candidatos"][pid]
            justificativa = (
                f"Planejamento em lote — Prof. {p.nome} ({p.tipo}), regência atual "
                f"{c['percentual_regencia']:.1f}%, competência {c['nivel_competencia']}/5."
            )
            alerta = None
            if c.get("manual"):
                alerta = f"Prof. {p.nome} escolhido manualmente — habilitação não cadastrada para esta UC."
            elif not c.get("disponivel", True):
                alerta = f"Prof. {p.nome} sem disponibilidade cadastrada neste horário. Verificar."
        else:
            motivo = motivo_base.get(i) or (
                "Os habilitados não têm carga semanal ou horário livre dentro deste lote "
                "(disputam com outras turmas)."
            )
            justificativa = motivo
            alerta = "⚠ Sem professor: " + motivo
            if n:
                sem_professor.append({
                    "evento_id": ev.id, "nome_turma": ev.nome_turma, "uc_id": uc.id, "uc_nome": uc.nome,
                    "aulas": n, "horas": round(n * it["horas_aula"], 1), "motivo": motivo,
                    "habilitados": [c["professor"].nome for c in it["candidatos"].values()][:8],
                })
        eventos_out[ev.id]["alocacoes"].append({
            "uc_id": uc.id,
            "uc_nome": uc.nome,
            "uc_codigo": uc.codigo_uc or "",
            "etapa": uc.modulo_etapa,
            "carga_horaria": uc.carga_horaria or 0,
            "professor_id": pid,
            "professor_nome": p.nome if p else None,
            "aulas_necessarias": a.aulas_necessarias,
            "datas_aulas": [d.isoformat() for d in sorted(it["datas"])],
            "justificativa": justificativa,
            "alerta": alerta,
            "score": float(it["candidatos"][pid]["score"]) if p else 0.0,
            "travado": bool(it["travado"]),
            "candidatos": [
                {"professor_id": c["professor"].id, "nome": c["professor"].nome, "tipo": c["professor"].tipo,
                 "disponivel": c.get("disponivel", True)}
                for c in sorted(it["candidatos"].values(), key=lambda c: -c["score"])
            ],
            "primeira_aula": min(it["datas"]).isoformat() if it["datas"] else None,
            "ultima_aula": max(it["datas"]).isoformat() if it["datas"] else None,
        })

    professores = []
    for pid, horas in sorted(horas_prof.items(), key=lambda kv: -kv[1]):
        p = prof_map[pid]
        semanas = [k for k in semana_prof if k[0] == pid]
        pico = max(
            (semana_prof[k] + horas_existentes.get(k, 0.0) for k in semanas), default=0.0
        )
        professores.append({
            "professor_id": pid, "nome": p.nome, "tipo": p.tipo,
            "horas_contratadas": p.horas_contratadas,
            "horas_lote": round(horas, 1), "ucs": ucs_prof[pid],
            "pico_semanal": round(pico, 1),
            "regencia_atual": regencias.get(pid, {}).get("percentual_regencia", 0),
        })

    return {
        "status": status_nome,
        "eventos": list(eventos_out.values()),
        "erros": erros,
        "sem_professor": sem_professor,
        "professores": professores,
        "resumo": {
            "eventos": len(eventos_out),
            "ucs": sum(1 for it in itens if it["datas"]),
            "cobertas": len(escolhido),
            "aulas": aulas_total,
            "aulas_cobertas": aulas_cobertas,
            "horas_sem_professor": round(sum(s["horas"] for s in sem_professor), 1),
        },
    }
