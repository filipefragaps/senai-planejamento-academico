"""Gestão da Não Regência Docente — projetos, alocações, entregas, apontamentos, dashboard e relatórios."""
import base64
import io
import logging
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, require_admin
from app.database import get_db
from app.models.nao_regencia import (
    NrAfastamento, NrAnexo, NrApontamento, NrCategoria, NrConfig, NrEntrega, NrHistorico, NrOutraAlocacao,
    NrProjeto, NrVinculo, NrVinculoPeriodo,
)
from app.models.professor import Professor
from app.models.usuario import Usuario
from app.services import nao_regencia as svc
from app.services.regencia import calcular_regencia_professor

router = APIRouter(prefix="/nao-regencia", tags=["Não Regência"])
log = logging.getLogger("app.nao_regencia")

LIMITE_ANEXO_MB = 5
MAX_DIAS_APONTAMENTO = 7


# ── Schemas ───────────────────────────────────────────────────────────────────

class Link(BaseModel):
    titulo: Optional[str] = None
    url: str


class ProjetoIn(BaseModel):
    nome: Optional[str] = None
    categoria_id: Optional[int] = None
    descricao: Optional[str] = None
    justificativa: Optional[str] = None
    objetivo: Optional[str] = None
    resultados_esperados: Optional[str] = None
    unidade: Optional[str] = None
    responsavel_id: Optional[int] = None
    data_inicio: Optional[date] = None
    data_fim_prevista: Optional[date] = None
    data_conclusao: Optional[date] = None
    continuo: Optional[bool] = None
    data_revisao: Optional[date] = None
    situacao: Optional[str] = None
    prioridade: Optional[str] = None
    ch_total_prevista: Optional[float] = None
    entregas_previstas: Optional[str] = None
    links: Optional[list[Link]] = None
    observacoes: Optional[str] = None
    justificativa_alteracao: Optional[str] = None
    encerrar_vinculos: bool = False


class PeriodoIn(BaseModel):
    data_inicio: date
    data_fim: Optional[date] = None
    horas_semanais: float


class VinculoIn(BaseModel):
    professor_id: Optional[int] = None
    papel: Optional[str] = None
    contribuicao: Optional[str] = None
    data_inicio: Optional[date] = None
    data_fim: Optional[date] = None
    horas_semanais: Optional[float] = None
    responsabilidades: Optional[str] = None
    gestor_id: Optional[int] = None
    justificativa: Optional[str] = None
    periodos: Optional[list[PeriodoIn]] = None
    justificativa_alteracao: Optional[str] = None


class VinculosLote(BaseModel):
    vinculos: list[VinculoIn]


class DecisaoIn(BaseModel):
    justificativa: Optional[str] = None
    data_fim: Optional[date] = None


class EntregaIn(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    responsaveis: Optional[list[int]] = None
    prazo: Optional[date] = None
    criterio_aceite: Optional[str] = None
    peso: Optional[float] = None
    situacao: Optional[str] = None
    evidencias: Optional[str] = None
    links: Optional[list[Link]] = None


class AvaliacaoIn(BaseModel):
    aprovar: bool
    parecer: Optional[str] = None


class ApontamentoIn(BaseModel):
    projeto_id: Optional[int] = None
    professor_id: Optional[int] = None
    data_inicio: Optional[date] = None
    data_fim: Optional[date] = None
    horas: Optional[float] = None
    descricao: Optional[str] = None
    entrega_id: Optional[int] = None
    evidencia: Optional[str] = None
    enviar: bool = False


class ValidacaoIn(BaseModel):
    ids: list[int]
    aprovar: bool
    parecer: Optional[str] = None


class AfastamentoIn(BaseModel):
    professor_id: int
    tipo: str
    data_inicio: date
    data_fim: date
    observacao: Optional[str] = None


class OutraAlocacaoIn(BaseModel):
    professor_id: int
    descricao: str
    data_inicio: date
    data_fim: Optional[date] = None
    horas_semanais: float


class CategoriaIn(BaseModel):
    nome: Optional[str] = None
    ativa: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _iso(d):
    return d.isoformat() if d else None


def _periodo(ini: Optional[date], fim: Optional[date]) -> tuple[date, date]:
    """Padrão: mês corrente."""
    if ini and fim:
        if fim < ini:
            raise HTTPException(400, "A data final do período é anterior à inicial")
        if (fim - ini).days > 800:
            raise HTTPException(400, "Período muito longo (máximo de 2 anos)")
        return ini, fim
    hoje = svc.hoje_br()
    ini = hoje.replace(day=1)
    prox = (ini + timedelta(days=32)).replace(day=1)
    return ini, prox - timedelta(days=1)


def _filtros(professor_id, unidade, categoria_id, projeto_id, responsavel_id, situacao) -> svc.Filtros:
    return svc.Filtros(professor_id=professor_id, unidade=unidade or None, categoria_id=categoria_id,
                       projeto_id=projeto_id, responsavel_id=responsavel_id, situacao=situacao or None)


def _links(v) -> Optional[list]:
    return [l.model_dump() for l in v] if v is not None else None


async def _projeto(db: AsyncSession, projeto_id: int) -> NrProjeto:
    p = (await db.execute(
        select(NrProjeto).options(
            selectinload(NrProjeto.categoria), selectinload(NrProjeto.responsavel),
            selectinload(NrProjeto.entregas),
            selectinload(NrProjeto.vinculos).selectinload(NrVinculo.periodos),
            selectinload(NrProjeto.vinculos).selectinload(NrVinculo.professor),
            selectinload(NrProjeto.vinculos).selectinload(NrVinculo.gestor),
        ).where(NrProjeto.id == projeto_id).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Projeto não encontrado")
    return p


def _pode_gerir(user: Usuario, p: NrProjeto) -> bool:
    return svc.eh_gestao(user) or p.responsavel_id == user.id


async def _exigir_visao(db: AsyncSession, user: Usuario, p: NrProjeto) -> svc.Escopo:
    esc = await svc.escopo_do_usuario(db, user)
    if not esc.tudo and p.id not in esc.projeto_ids:
        raise HTTPException(403, "Você não participa deste projeto")
    return esc


def _exigir_gestao_projeto(user: Usuario, p: NrProjeto) -> None:
    if not _pode_gerir(user, p):
        raise HTTPException(403, "Somente a gestão ou o responsável pelo projeto pode fazer esta alteração")


async def _nomes_usuarios(db: AsyncSession, ids) -> dict[int, str]:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return dict((await db.execute(select(Usuario.id, Usuario.nome).where(Usuario.id.in_(ids)))).all())


async def _nomes_professores(db: AsyncSession, ids) -> dict[int, str]:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return dict((await db.execute(select(Professor.id, Professor.nome).where(Professor.id.in_(ids)))).all())


def _ser_vinculo(v: NrVinculo, previsto_periodo: Optional[float] = None) -> dict:
    return {
        "id": v.id, "projeto_id": v.projeto_id,
        "projeto_nome": v.projeto.nome if "projeto" in v.__dict__ and v.projeto else None,
        "projeto_codigo": v.projeto.codigo if "projeto" in v.__dict__ and v.projeto else None,
        "professor_id": v.professor_id,
        "professor_nome": v.professor.nome if "professor" in v.__dict__ and v.professor else None,
        "professor_foto": v.professor.foto if "professor" in v.__dict__ and v.professor else None,
        "papel": v.papel, "contribuicao": v.contribuicao, "responsabilidades": v.responsabilidades,
        "data_inicio": _iso(v.data_inicio), "data_fim": _iso(v.data_fim), "horas_semanais": v.horas_semanais,
        "periodos": [{"id": p.id, "data_inicio": _iso(p.data_inicio), "data_fim": _iso(p.data_fim),
                      "horas_semanais": p.horas_semanais} for p in (v.periodos if "periodos" in v.__dict__ else [])],
        "gestor_id": v.gestor_id, "gestor_nome": v.gestor.nome if "gestor" in v.__dict__ and v.gestor else None,
        "situacao": v.situacao, "situacao_label": svc.SITUACAO_VINCULO.get(v.situacao, v.situacao),
        "justificativa": v.justificativa, "aprovado_em": v.aprovado_em.isoformat() if v.aprovado_em else None,
        "previsto_periodo": round(previsto_periodo, 2) if previsto_periodo is not None else None,
    }


def _ser_entrega(e: NrEntrega, profs: dict[int, str], anexos: Optional[list] = None, projeto: Optional[NrProjeto] = None) -> dict:
    hoje = svc.hoje_br()
    return {
        "id": e.id, "projeto_id": e.projeto_id,
        "projeto_nome": projeto.nome if projeto else None, "projeto_codigo": projeto.codigo if projeto else None,
        "titulo": e.titulo, "descricao": e.descricao,
        "responsaveis": [{"id": i, "nome": profs.get(i, f"#{i}")} for i in (e.responsaveis or [])],
        "prazo": _iso(e.prazo), "criterio_aceite": e.criterio_aceite, "peso": e.peso,
        "situacao": e.situacao, "situacao_label": svc.SITUACAO_ENTREGA.get(e.situacao, e.situacao),
        "atrasada": bool(e.prazo and e.prazo < hoje and e.situacao != "aprovada"),
        "data_submissao": _iso(e.data_submissao), "data_aprovacao": _iso(e.data_aprovacao),
        "evidencias": e.evidencias, "links": e.links or [], "parecer": e.parecer,
        "anexos": anexos or [],
    }


def _ser_apontamento(a: NrApontamento, profs: dict, projetos: dict, usuarios: dict, horas_periodo=None) -> dict:
    return {
        "id": a.id, "projeto_id": a.projeto_id,
        "projeto_nome": projetos.get(a.projeto_id, {}).get("nome"),
        "projeto_codigo": projetos.get(a.projeto_id, {}).get("codigo"),
        "professor_id": a.professor_id, "professor_nome": profs.get(a.professor_id),
        "data_inicio": _iso(a.data_inicio), "data_fim": _iso(a.data_fim), "horas": a.horas,
        "horas_periodo": round(horas_periodo, 2) if horas_periodo is not None else None,
        "descricao": a.descricao, "entrega_id": a.entrega_id, "evidencia": a.evidencia,
        "situacao": a.situacao, "situacao_label": svc.SITUACAO_APONTAMENTO.get(a.situacao, a.situacao),
        "enviado_em": a.enviado_em.isoformat() if a.enviado_em else None,
        "validado_por": usuarios.get(a.validado_por_id), "validado_em": a.validado_em.isoformat() if a.validado_em else None,
        "parecer": a.parecer, "criado_por_id": a.criado_por_id,
    }


def _ser_projeto_resumo(p: NrProjeto) -> dict:
    vs = p.vinculos if "vinculos" in p.__dict__ else []
    hoje = svc.hoje_br()
    return {
        "id": p.id, "codigo": p.codigo, "nome": p.nome,
        "categoria_id": p.categoria_id, "categoria": p.categoria.nome if p.categoria else None,
        "unidade": p.unidade, "responsavel_id": p.responsavel_id,
        "responsavel_nome": p.responsavel.nome if p.responsavel else None,
        "data_inicio": _iso(p.data_inicio), "data_fim_prevista": _iso(p.data_fim_prevista),
        "data_conclusao": _iso(p.data_conclusao), "continuo": p.continuo, "data_revisao": _iso(p.data_revisao),
        "revisao_vencida": bool(p.continuo and p.data_revisao and p.data_revisao < hoje
                                and p.situacao not in svc.PROJETO_ENCERRADO),
        "prazo_vencido": bool(not p.continuo and p.data_fim_prevista and p.data_fim_prevista < hoje
                              and p.situacao not in svc.PROJETO_ENCERRADO),
        "situacao": p.situacao, "situacao_label": svc.SITUACAO_PROJETO.get(p.situacao, p.situacao),
        "prioridade": p.prioridade, "prioridade_label": svc.PRIORIDADE.get(p.prioridade, p.prioridade),
        "ch_total_prevista": p.ch_total_prevista,
        "professores": len({v.professor_id for v in vs if v.situacao in {"proposta", "aprovada"}}),
        "horas_semanais_aprovadas": round(sum(v.horas_semanais for v in vs if v.situacao == "aprovada"), 2),
        "horas_semanais_propostas": round(sum(v.horas_semanais for v in vs if v.situacao == "proposta"), 2),
        "entregas": len(p.entregas), "entregas_aprovadas": sum(1 for e in p.entregas if e.situacao == "aprovada"),
        "entregas_atrasadas": sum(1 for e in p.entregas if e.prazo and e.prazo < hoje and e.situacao != "aprovada"),
        "progresso": svc.progresso(p.entregas),
    }


async def _anexos(db: AsyncSession, **filtro) -> list[dict]:
    q = select(NrAnexo.id, NrAnexo.nome, NrAnexo.mime, NrAnexo.tamanho, NrAnexo.entrega_id, NrAnexo.apontamento_id,
               NrAnexo.criado_em)
    for k, v in filtro.items():
        q = q.where(getattr(NrAnexo, k) == v)
    return [{"id": a.id, "nome": a.nome, "mime": a.mime, "tamanho": a.tamanho, "entrega_id": a.entrega_id,
             "apontamento_id": a.apontamento_id, "criado_em": a.criado_em.isoformat() if a.criado_em else None}
            for a in (await db.execute(q.order_by(NrAnexo.id))).all()]


def _validar_projeto(p: NrProjeto) -> None:
    if not (p.nome or "").strip():
        raise HTTPException(400, "Informe o nome do projeto ou atividade")
    if p.situacao not in svc.SITUACAO_PROJETO:
        raise HTTPException(400, "Situação inválida")
    if p.prioridade not in svc.PRIORIDADE:
        raise HTTPException(400, "Prioridade inválida")
    if p.ch_total_prevista is not None and p.ch_total_prevista < 0:
        raise HTTPException(400, "A carga horária total não pode ser negativa")
    if p.situacao != "rascunho":
        if not p.data_inicio:
            raise HTTPException(400, "Informe a data de início")
        if p.continuo and not p.data_revisao:
            raise HTTPException(400, "Atividade contínua exige a data de revisão da alocação")
        if not p.continuo and not p.data_fim_prevista:
            raise HTTPException(400, "Informe o término previsto (ou marque como atividade contínua)")
    if p.data_inicio and p.data_fim_prevista and p.data_fim_prevista < p.data_inicio:
        raise HTTPException(400, "O término previsto é anterior ao início")
    if p.situacao in svc.PROJETO_ENCERRADO and not p.data_conclusao:
        p.data_conclusao = svc.hoje_br()
    if p.data_conclusao and p.data_inicio and p.data_conclusao < p.data_inicio:
        raise HTTPException(400, "A data de conclusão é anterior ao início")


# ── Opções e configuração ─────────────────────────────────────────────────────

@router.get("/opcoes")
async def opcoes(db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    await svc.garantir_categorias(db)
    cats = (await db.execute(select(NrCategoria).order_by(NrCategoria.ordem, NrCategoria.nome))).scalars().all()
    profs = (await db.execute(
        select(Professor.id, Professor.nome, Professor.foto, Professor.tipo, Professor.horas_contratadas, Professor.ativo)
        .order_by(Professor.nome)
    )).all()
    usuarios = (await db.execute(
        select(Usuario.id, Usuario.nome, Usuario.perfil).where(Usuario.ativo == True).order_by(Usuario.nome)  # noqa: E712
    )).all()
    unidades = sorted({u for u in (await db.execute(select(NrProjeto.unidade).distinct())).scalars().all() if u})
    esc = await svc.escopo_do_usuario(db, user)
    return {
        "categorias": [{"id": c.id, "nome": c.nome, "ativa": c.ativa} for c in cats],
        "situacoes_projeto": [{"value": k, "label": v} for k, v in svc.SITUACAO_PROJETO.items()],
        "prioridades": [{"value": k, "label": v} for k, v in svc.PRIORIDADE.items()],
        "situacoes_vinculo": [{"value": k, "label": v} for k, v in svc.SITUACAO_VINCULO.items()],
        "situacoes_entrega": [{"value": k, "label": v} for k, v in svc.SITUACAO_ENTREGA.items()],
        "situacoes_apontamento": [{"value": k, "label": v} for k, v in svc.SITUACAO_APONTAMENTO.items()],
        "tipos_afastamento": svc.TIPOS_AFASTAMENTO,
        "professores": [{"id": p.id, "nome": p.nome, "foto": p.foto, "tipo": p.tipo,
                         "horas_semanais": p.horas_contratadas, "ativo": p.ativo} for p in profs],
        "usuarios": [{"id": u.id, "nome": u.nome, "perfil": u.perfil, "gestao": u.perfil in svc.PERFIS_GESTAO}
                     for u in usuarios],
        "unidades": unidades,
        "eu": {"id": user.id, "nome": user.nome, "perfil": user.perfil, "gestao": esc.tudo,
               "admin": user.perfil == "admin", "professor_id": esc.professor_id, "coordena": sorted(esc.coordena)},
    }


@router.get("/config")
async def ler_config(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    cfg = await svc.config(db)
    return [{"chave": k, "valor": cfg[k], "padrao": padrao, "descricao": desc, "decisao_pendente": pend}
            for k, (padrao, desc, pend) in svc.CONFIG_PADRAO.items()]


@router.put("/config")
async def salvar_config(dados: dict[str, Optional[str]], db: AsyncSession = Depends(get_db),
                        user: Usuario = Depends(require_admin)):
    for k, v in dados.items():
        if k not in svc.CONFIG_PADRAO:
            raise HTTPException(400, f"Parâmetro desconhecido: {k}")
        v = (v or "").strip()
        if k not in ("dias_semana_trabalho", "tipos_calendario_nao_util") and v:
            try:
                if float(v.replace(",", ".")) < 0:
                    raise ValueError
            except ValueError:
                raise HTTPException(400, f"Valor inválido para {k}")
        row = await db.get(NrConfig, k)
        if row:
            row.valor = v
        else:
            db.add(NrConfig(chave=k, valor=v))
        svc.registrar(db, user, "config", None, None, "alteracao", f"{k} = {v or '(padrão)'}")
    await db.flush()
    return await ler_config(db, user)


@router.post("/categorias")
async def criar_categoria(data: CategoriaIn, db: AsyncSession = Depends(get_db), user: Usuario = Depends(require_admin)):
    nome = (data.nome or "").strip()
    if not nome:
        raise HTTPException(400, "Informe o nome da categoria")
    if (await db.execute(select(NrCategoria).where(func.lower(NrCategoria.nome) == nome.lower()))).scalar_one_or_none():
        raise HTTPException(400, "Já existe uma categoria com esse nome")
    ordem = (await db.execute(select(func.max(NrCategoria.ordem)))).scalar() or 0
    c = NrCategoria(nome=nome, ordem=ordem + 1, ativa=True)
    db.add(c)
    await db.flush()
    svc.registrar(db, user, "categoria", c.id, None, "criacao", nome)
    return {"id": c.id, "nome": c.nome, "ativa": c.ativa}


@router.put("/categorias/{cat_id}")
async def editar_categoria(cat_id: int, data: CategoriaIn, db: AsyncSession = Depends(get_db),
                           user: Usuario = Depends(require_admin)):
    c = await db.get(NrCategoria, cat_id)
    if not c:
        raise HTTPException(404, "Categoria não encontrada")
    if data.nome is not None and data.nome.strip():
        c.nome = data.nome.strip()
    if data.ativa is not None:
        c.ativa = data.ativa
    svc.registrar(db, user, "categoria", c.id, None, "alteracao", f"{c.nome} ({'ativa' if c.ativa else 'inativa'})")
    await db.flush()
    return {"id": c.id, "nome": c.nome, "ativa": c.ativa}


# ── Projetos ──────────────────────────────────────────────────────────────────

@router.get("/projetos")
async def listar_projetos(
    busca: Optional[str] = None, categoria_id: Optional[int] = None, situacao: Optional[str] = None,
    unidade: Optional[str] = None, responsavel_id: Optional[int] = None, professor_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    esc = await svc.escopo_do_usuario(db, user)
    q = select(NrProjeto).options(selectinload(NrProjeto.categoria), selectinload(NrProjeto.responsavel),
                                  selectinload(NrProjeto.entregas), selectinload(NrProjeto.vinculos))
    if not esc.tudo:
        q = q.where(NrProjeto.id.in_(list(esc.projeto_ids) or [0]))
    if categoria_id:
        q = q.where(NrProjeto.categoria_id == categoria_id)
    if situacao:
        q = q.where(NrProjeto.situacao == situacao)
    if unidade:
        q = q.where(func.lower(NrProjeto.unidade) == unidade.lower())
    if responsavel_id:
        q = q.where(NrProjeto.responsavel_id == responsavel_id)
    if professor_id:
        q = q.where(NrProjeto.id.in_(select(NrVinculo.projeto_id).where(NrVinculo.professor_id == professor_id)))
    if busca:
        t = f"%{busca.strip().lower()}%"
        q = q.where(func.lower(NrProjeto.nome).like(t) | func.lower(NrProjeto.codigo).like(t))
    projetos = (await db.execute(q.order_by(NrProjeto.id.desc()))).scalars().all()
    return [_ser_projeto_resumo(p) for p in projetos]


@router.post("/projetos")
async def criar_projeto(data: ProjetoIn, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    if not svc.eh_gestao(user):
        raise HTTPException(403, "Somente a gestão pode cadastrar projetos e atividades")
    campos = data.model_dump(exclude={"justificativa_alteracao", "encerrar_vinculos", "links"}, exclude_unset=True)
    p = NrProjeto(**{k: v for k, v in campos.items() if v is not None})
    p.links = _links(data.links)
    p.situacao = p.situacao or "rascunho"
    p.prioridade = p.prioridade or "media"
    p.continuo = bool(p.continuo)
    p.criado_por_id = user.id
    _validar_projeto(p)
    if p.categoria_id and not await db.get(NrCategoria, p.categoria_id):
        raise HTTPException(400, "Categoria não encontrada")
    db.add(p)
    await db.flush()
    p.codigo = f"NR-{(p.data_inicio or svc.hoje_br()).year}-{p.id:04d}"
    svc.registrar(db, user, "projeto", p.id, p.id, "criacao", f"{p.codigo} {p.nome}")
    await db.flush()
    return await obter_projeto(p.id, db, user)


@router.get("/projetos/{projeto_id}")
async def obter_projeto(projeto_id: int, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    p = await _projeto(db, projeto_id)
    esc = await _exigir_visao(db, user, p)
    profs = await _nomes_professores(db, [i for e in p.entregas for i in (e.responsaveis or [])])
    anexos = await _anexos(db, projeto_id=p.id)
    vinculos = p.vinculos
    if not esc.tudo and p.id not in esc.coordena:
        vinculos = [v for v in vinculos if v.professor_id == esc.professor_id]
    hist = (await db.execute(
        select(NrHistorico).where(NrHistorico.projeto_id == p.id).order_by(NrHistorico.id.desc()).limit(300)
    )).scalars().all()
    return {
        **_ser_projeto_resumo(p),
        "descricao": p.descricao, "justificativa": p.justificativa, "objetivo": p.objetivo,
        "resultados_esperados": p.resultados_esperados, "entregas_previstas": p.entregas_previstas,
        "links": p.links or [], "observacoes": p.observacoes,
        "pode_gerir": _pode_gerir(user, p),
        "vinculos": [_ser_vinculo(v) for v in sorted(vinculos, key=lambda v: (v.situacao != "aprovada", v.id))],
        "entregas": [_ser_entrega(e, profs, [a for a in anexos if a["entrega_id"] == e.id]) for e in p.entregas],
        "anexos": [a for a in anexos if not a["entrega_id"] and not a["apontamento_id"]],
        "historico": [{"id": h.id, "entidade": h.entidade, "acao": h.acao, "detalhe": h.detalhe,
                       "justificativa": h.justificativa, "usuario": h.usuario_nome,
                       "criado_em": h.criado_em.isoformat() if h.criado_em else None} for h in hist],
    }


@router.put("/projetos/{projeto_id}")
async def editar_projeto(projeto_id: int, data: ProjetoIn, db: AsyncSession = Depends(get_db),
                         user: Usuario = Depends(get_current_user)):
    p = await _projeto(db, projeto_id)
    _exigir_gestao_projeto(user, p)
    enviados = data.model_dump(exclude={"justificativa_alteracao", "encerrar_vinculos"}, exclude_unset=True)
    if "responsavel_id" in enviados and not svc.eh_gestao(user) and enviados["responsavel_id"] != p.responsavel_id:
        raise HTTPException(403, "Somente a gestão pode trocar o responsável pelo projeto")
    situacao_antes = p.situacao
    nova = enviados.get("situacao") or situacao_antes
    if nova != situacao_antes and nova in svc.PROJETO_ENCERRADO | {"suspenso"} \
            and not (data.justificativa_alteracao or "").strip():
        raise HTTPException(400, "Informe a justificativa para suspender, concluir ou cancelar")
    mudou = []
    for k, v in enviados.items():
        if k == "links":
            v = _links(data.links)
        if getattr(p, k) != v:
            mudou.append(k)
            setattr(p, k, v)
    p.continuo = bool(p.continuo)
    _validar_projeto(p)
    if p.categoria_id and not await db.get(NrCategoria, p.categoria_id):
        raise HTTPException(400, "Categoria não encontrada")
    if mudou:
        if p.situacao != situacao_antes:
            svc.registrar(db, user, "projeto", p.id, p.id, "situacao",
                          f"{svc.SITUACAO_PROJETO[situacao_antes]} → {svc.SITUACAO_PROJETO[p.situacao]}",
                          data.justificativa_alteracao)
        outros = [m for m in mudou if m != "situacao"]
        if outros:
            svc.registrar(db, user, "projeto", p.id, p.id, "alteracao", "Campos: " + ", ".join(outros),
                          data.justificativa_alteracao)
    if p.situacao in svc.PROJETO_ENCERRADO and data.encerrar_vinculos:
        await _encerrar_vinculos_do_projeto(db, user, p, data.justificativa_alteracao)
    await db.flush()
    db.expire(p)
    return await obter_projeto(projeto_id, db, user)


async def _encerrar_vinculos_do_projeto(db, user, p: NrProjeto, justificativa):
    fim = p.data_conclusao or svc.hoje_br()
    for v in p.vinculos:
        if v.situacao == "aprovada":
            v.situacao = "encerrada"
            v.data_fim = min(v.data_fim, fim) if v.data_fim else fim
            svc.registrar(db, user, "vinculo", v.id, p.id, "encerramento",
                          f"{v.professor.nome if v.professor else ''}: encerrado em {fim.strftime('%d/%m/%Y')} com o projeto",
                          justificativa)
        elif v.situacao == "proposta":
            v.situacao = "cancelada"
            svc.registrar(db, user, "vinculo", v.id, p.id, "cancelamento",
                          f"{v.professor.nome if v.professor else ''}: proposta cancelada com o encerramento do projeto",
                          justificativa)


@router.delete("/projetos/{projeto_id}", status_code=204)
async def excluir_projeto(projeto_id: int, db: AsyncSession = Depends(get_db), user: Usuario = Depends(require_admin)):
    p = await db.get(NrProjeto, projeto_id)
    if not p:
        raise HTTPException(404, "Projeto não encontrado")
    tem_horas = (await db.execute(select(func.count(NrApontamento.id)).where(
        NrApontamento.projeto_id == p.id, NrApontamento.situacao == "aprovado"))).scalar()
    if tem_horas:
        raise HTTPException(400, "Projeto com horas validadas não pode ser excluído: cancele-o para manter o histórico")
    log.warning("Não regência: projeto %s excluído por %s", p.codigo, user.email)
    await db.delete(p)


# ── Vínculos ──────────────────────────────────────────────────────────────────

def _validar_vinculo(v: NrVinculo, p: NrProjeto) -> None:
    if v.horas_semanais is None or v.horas_semanais <= 0 or v.horas_semanais > 60:
        raise HTTPException(400, "Informe a carga semanal (entre 0 e 60 horas)")
    if not v.data_inicio:
        raise HTTPException(400, "Informe o início da participação")
    if v.data_fim and v.data_fim < v.data_inicio:
        raise HTTPException(400, "O término da participação é anterior ao início")
    if p.data_inicio and v.data_inicio < p.data_inicio:
        raise HTTPException(400, f"A participação não pode começar antes do projeto ({p.data_inicio.strftime('%d/%m/%Y')})")
    limite = p.data_conclusao or (None if p.continuo else p.data_fim_prevista)
    if limite and v.data_fim and v.data_fim > limite:
        raise HTTPException(400, f"A participação não pode terminar depois do projeto ({limite.strftime('%d/%m/%Y')})")


def _aplicar_periodos(v: NrVinculo, periodos: list[PeriodoIn]) -> None:
    ordenados = sorted(periodos, key=lambda x: x.data_inicio)
    for i, pe in enumerate(ordenados):
        if pe.horas_semanais < 0 or pe.horas_semanais > 60:
            raise HTTPException(400, "Carga semanal do período inválida")
        if pe.data_fim and pe.data_fim < pe.data_inicio:
            raise HTTPException(400, "Período com término anterior ao início")
        if pe.data_inicio < v.data_inicio or (v.data_fim and (pe.data_fim or v.data_fim) > v.data_fim):
            raise HTTPException(400, "As faixas de carga devem ficar dentro da participação")
        if i and (ordenados[i - 1].data_fim is None or ordenados[i - 1].data_fim >= pe.data_inicio):
            raise HTTPException(400, "As faixas de carga não podem se sobrepor")
    v.periodos.clear()
    for pe in ordenados:
        v.periodos.append(NrVinculoPeriodo(data_inicio=pe.data_inicio, data_fim=pe.data_fim, horas_semanais=pe.horas_semanais))


@router.post("/projetos/{projeto_id}/vinculos")
async def criar_vinculos(projeto_id: int, data: VinculosLote, db: AsyncSession = Depends(get_db),
                         user: Usuario = Depends(get_current_user)):
    """Vincula vários professores de uma vez; cada vínculo nasce como proposta."""
    p = await _projeto(db, projeto_id)
    _exigir_gestao_projeto(user, p)
    if p.situacao in svc.PROJETO_ENCERRADO:
        raise HTTPException(400, "Projeto encerrado não recebe novos vínculos")
    if not data.vinculos:
        raise HTTPException(400, "Nenhum professor informado")
    criados = []
    for item in data.vinculos:
        prof = await db.get(Professor, item.professor_id) if item.professor_id else None
        if not prof:
            raise HTTPException(400, "Professor não encontrado")
        v = NrVinculo(projeto_id=p.id, professor_id=prof.id, papel=item.papel, contribuicao=item.contribuicao,
                      data_inicio=item.data_inicio or p.data_inicio,
                      data_fim=item.data_fim or (None if p.continuo else p.data_fim_prevista),
                      horas_semanais=item.horas_semanais, responsabilidades=item.responsabilidades,
                      gestor_id=item.gestor_id, justificativa=item.justificativa, situacao="proposta")
        v.projeto = p
        v.periodos = []
        _validar_vinculo(v, p)
        if item.periodos:
            _aplicar_periodos(v, item.periodos)
        db.add(v)
        await db.flush()
        svc.registrar(db, user, "vinculo", v.id, p.id, "criacao",
                      f"{prof.nome}: {v.horas_semanais:g}h/sem de {v.data_inicio.strftime('%d/%m/%Y')}"
                      + (f" a {v.data_fim.strftime('%d/%m/%Y')}" if v.data_fim else "") + " (proposta)",
                      item.justificativa)
        criados.append(v.id)
    await db.flush()
    return {"criados": criados}


async def _vinculo(db: AsyncSession, vinculo_id: int) -> NrVinculo:
    v = (await db.execute(
        select(NrVinculo).options(selectinload(NrVinculo.periodos), selectinload(NrVinculo.professor),
                                  selectinload(NrVinculo.gestor), selectinload(NrVinculo.projeto))
        .where(NrVinculo.id == vinculo_id)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vínculo não encontrado")
    return v


@router.put("/vinculos/{vinculo_id}")
async def editar_vinculo(vinculo_id: int, data: VinculoIn, db: AsyncSession = Depends(get_db),
                         user: Usuario = Depends(get_current_user)):
    v = await _vinculo(db, vinculo_id)
    _exigir_gestao_projeto(user, v.projeto)
    if v.situacao in {"encerrada", "cancelada"}:
        raise HTTPException(400, "Vínculo encerrado ou cancelado não pode ser alterado")
    antes = (v.horas_semanais, v.data_inicio, v.data_fim, [(p.data_inicio, p.data_fim, p.horas_semanais) for p in v.periodos])
    for k in ("papel", "contribuicao", "data_inicio", "data_fim", "horas_semanais", "responsabilidades",
              "gestor_id", "justificativa"):
        if k in data.model_fields_set:
            setattr(v, k, getattr(data, k))
    _validar_vinculo(v, v.projeto)
    if data.periodos is not None:
        _aplicar_periodos(v, data.periodos)
    depois = (v.horas_semanais, v.data_inicio, v.data_fim, [(p.data_inicio, p.data_fim, p.horas_semanais) for p in v.periodos])
    mudou_carga = antes != depois
    if mudou_carga and v.situacao == "aprovada" and not (data.justificativa_alteracao or "").strip():
        raise HTTPException(400, "Informe a justificativa para alterar a carga de um vínculo aprovado")
    nome = v.professor.nome if v.professor else ""
    svc.registrar(db, user, "vinculo", v.id, v.projeto_id, "alteracao_carga" if mudou_carga else "alteracao",
                  f"{nome}: {antes[0]:g}h/sem → {v.horas_semanais:g}h/sem" if mudou_carga else f"{nome}: dados do vínculo",
                  data.justificativa_alteracao)
    await db.flush()
    return _ser_vinculo(await _vinculo(db, v.id))


async def _nao_eh_o_proprio(db: AsyncSession, user: Usuario, professor_ids, acao: str) -> None:
    eu = await svc.professor_do_usuario(db, user)
    if eu and eu.id in set(professor_ids):
        raise HTTPException(403, f"Você não pode {acao} a sua própria participação: encaminhe a outro gestor autorizado")


@router.post("/vinculos/{vinculo_id}/aprovar")
async def aprovar_vinculo(vinculo_id: int, data: DecisaoIn, db: AsyncSession = Depends(get_db),
                          user: Usuario = Depends(get_current_user)):
    v = await _vinculo(db, vinculo_id)
    if not (svc.eh_gestao(user) or v.gestor_id == user.id):
        raise HTTPException(403, "Somente a gestão (ou o gestor indicado no vínculo) aprova alocações")
    await _nao_eh_o_proprio(db, user, [v.professor_id], "aprovar")
    if v.situacao != "proposta":
        raise HTTPException(400, "Somente propostas podem ser aprovadas")
    if v.projeto.situacao in svc.PROJETO_ENCERRADO | {"rascunho"}:
        raise HTTPException(400, "Mude o projeto de rascunho para planejado/em andamento antes de aprovar alocações")
    v.situacao = "aprovada"
    v.aprovado_por_id = user.id
    v.aprovado_em = svc.agora()
    svc.registrar(db, user, "vinculo", v.id, v.projeto_id, "aprovacao",
                  f"{v.professor.nome if v.professor else ''}: {v.horas_semanais:g}h/sem aprovadas", data.justificativa)
    await db.flush()
    return _ser_vinculo(await _vinculo(db, v.id))


@router.post("/vinculos/{vinculo_id}/encerrar")
async def encerrar_vinculo(vinculo_id: int, data: DecisaoIn, db: AsyncSession = Depends(get_db),
                           user: Usuario = Depends(get_current_user)):
    v = await _vinculo(db, vinculo_id)
    _exigir_gestao_projeto(user, v.projeto)
    if v.situacao not in {"aprovada", "proposta"}:
        raise HTTPException(400, "Vínculo já encerrado ou cancelado")
    if not (data.justificativa or "").strip():
        raise HTTPException(400, "Informe a justificativa")
    nome = v.professor.nome if v.professor else ""
    if v.situacao == "proposta":
        v.situacao = "cancelada"
        svc.registrar(db, user, "vinculo", v.id, v.projeto_id, "cancelamento", f"{nome}: proposta cancelada", data.justificativa)
    else:
        fim = data.data_fim or svc.hoje_br()
        if fim < v.data_inicio:
            v.situacao = "cancelada"
            svc.registrar(db, user, "vinculo", v.id, v.projeto_id, "cancelamento",
                          f"{nome}: cancelado antes de começar", data.justificativa)
        else:
            v.situacao = "encerrada"
            v.data_fim = min(v.data_fim, fim) if v.data_fim else fim
            svc.registrar(db, user, "vinculo", v.id, v.projeto_id, "encerramento",
                          f"{nome}: encerrado em {v.data_fim.strftime('%d/%m/%Y')}", data.justificativa)
    await db.flush()
    return _ser_vinculo(await _vinculo(db, v.id))


@router.get("/vinculos")
async def listar_vinculos(
    professor_id: Optional[int] = None, situacao: Optional[str] = None, ini: Optional[date] = None,
    fim: Optional[date] = None, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    """Alocações (todas as participações) com as horas previstas no período — base da aba Alocação."""
    ini, fim = _periodo(ini, fim)
    esc = await svc.escopo_do_usuario(db, user)
    res = await svc.calcular(db, ini, fim, svc.Filtros(professor_id=professor_id), esc)
    vs = res["vinculos"]
    if situacao:
        vs = [v for v in vs if v.situacao == situacao]
    return [_ser_vinculo(v, res["prev_vinc"].get(v.id)) for v in sorted(vs, key=lambda v: (v.professor.nome if v.professor else "", v.id))]


@router.get("/disponibilidade")
async def consultar_disponibilidade(
    professor_ids: str, ini: Optional[date] = None, fim: Optional[date] = None,
    horas_semanais: float = 0, excluir_vinculo_id: Optional[int] = None, horas_por: Optional[str] = None,
    db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    """Saldo de carga antes e depois da alocação proposta, para decidir antes de aprovar.
    `horas_por` = "professor_id:h,..." quando cada professor recebe uma carga semanal diferente."""
    esc = await svc.escopo_do_usuario(db, user)
    if not esc.tudo and not esc.coordena:
        raise HTTPException(403, "Consulta disponível para a gestão e responsáveis por projetos")
    ids = [int(x) for x in professor_ids.split(",") if x.strip().isdigit()]
    por: dict[int, float] = {}
    for par in (horas_por or "").split(","):
        k, _, v = par.partition(":")
        try:
            por[int(k)] = float(v)
        except ValueError:
            continue
    ini, fim = _periodo(ini, fim)
    return {"periodo": {"inicio": ini.isoformat(), "fim": fim.isoformat()},
            "professores": await svc.disponibilidade(db, ids, ini, fim, horas_semanais, excluir_vinculo_id, por)}


# ── Entregas ──────────────────────────────────────────────────────────────────

async def _entrega(db: AsyncSession, entrega_id: int) -> tuple[NrEntrega, NrProjeto]:
    e = await db.get(NrEntrega, entrega_id)
    if not e:
        raise HTTPException(404, "Entrega não encontrada")
    return e, await _projeto(db, e.projeto_id)


def _validar_entrega(e: NrEntrega) -> None:
    if not (e.titulo or "").strip():
        raise HTTPException(400, "Informe o título da entrega")
    if e.peso is not None and e.peso < 0:
        raise HTTPException(400, "O peso não pode ser negativo")
    if e.situacao not in svc.SITUACAO_ENTREGA:
        raise HTTPException(400, "Situação inválida")


@router.post("/projetos/{projeto_id}/entregas")
async def criar_entrega(projeto_id: int, data: EntregaIn, db: AsyncSession = Depends(get_db),
                        user: Usuario = Depends(get_current_user)):
    p = await _projeto(db, projeto_id)
    _exigir_gestao_projeto(user, p)
    e = NrEntrega(projeto_id=p.id, titulo=data.titulo, descricao=data.descricao, responsaveis=data.responsaveis or [],
                  prazo=data.prazo, criterio_aceite=data.criterio_aceite, peso=data.peso,
                  situacao=data.situacao if data.situacao in {"nao_iniciada", "em_andamento"} else "nao_iniciada",
                  evidencias=data.evidencias, links=_links(data.links))
    _validar_entrega(e)
    db.add(e)
    await db.flush()
    svc.registrar(db, user, "entrega", e.id, p.id, "criacao", e.titulo)
    return {"id": e.id}


@router.put("/entregas/{entrega_id}")
async def editar_entrega(entrega_id: int, data: EntregaIn, db: AsyncSession = Depends(get_db),
                         user: Usuario = Depends(get_current_user)):
    """Gestão/responsável alteram tudo; o professor responsável atualiza andamento e evidências."""
    e, p = await _entrega(db, entrega_id)
    gestor = _pode_gerir(user, p)
    eu = await svc.professor_do_usuario(db, user)
    meu = eu and eu.id in (e.responsaveis or [])
    if not gestor and not meu:
        raise HTTPException(403, "Sem permissão para alterar esta entrega")
    if e.situacao == "aprovada":
        raise HTTPException(400, "Entrega aprovada não pode ser alterada")
    campos = data.model_fields_set
    if not gestor:
        proibidos = campos - {"evidencias", "links", "situacao"}
        if proibidos:
            raise HTTPException(403, "O professor pode atualizar apenas o andamento e as evidências")
    if "situacao" in campos and data.situacao not in {"nao_iniciada", "em_andamento"}:
        raise HTTPException(400, "Use 'Enviar para validação' e 'Avaliar' para mudar a entrega para essas situações")
    for k in campos:
        setattr(e, k, _links(data.links) if k == "links" else getattr(data, k))
    _validar_entrega(e)
    svc.registrar(db, user, "entrega", e.id, p.id, "alteracao", e.titulo)
    await db.flush()
    return {"id": e.id}


@router.delete("/entregas/{entrega_id}", status_code=204)
async def excluir_entrega(entrega_id: int, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    e, p = await _entrega(db, entrega_id)
    _exigir_gestao_projeto(user, p)
    if e.situacao == "aprovada":
        raise HTTPException(400, "Entrega aprovada não pode ser excluída")
    svc.registrar(db, user, "entrega", e.id, p.id, "exclusao", e.titulo)
    await db.delete(e)


@router.post("/entregas/{entrega_id}/submeter")
async def submeter_entrega(entrega_id: int, data: EntregaIn, db: AsyncSession = Depends(get_db),
                           user: Usuario = Depends(get_current_user)):
    e, p = await _entrega(db, entrega_id)
    eu = await svc.professor_do_usuario(db, user)
    if not (_pode_gerir(user, p) or (eu and eu.id in (e.responsaveis or []))):
        raise HTTPException(403, "Somente os responsáveis pela entrega podem enviá-la")
    if e.situacao in {"aprovada", "submetida"}:
        raise HTTPException(400, "Entrega já enviada ou aprovada")
    if data.evidencias is not None:
        e.evidencias = data.evidencias
    if data.links is not None:
        e.links = _links(data.links)
    tem_anexo = (await db.execute(select(func.count(NrAnexo.id)).where(NrAnexo.entrega_id == e.id))).scalar()
    if not ((e.evidencias or "").strip() or e.links or tem_anexo):
        raise HTTPException(400, "Informe as evidências (descrição, link ou arquivo) antes de enviar")
    e.situacao = "submetida"
    e.data_submissao = svc.hoje_br()
    e.submetido_por_id = user.id
    svc.registrar(db, user, "entrega", e.id, p.id, "submissao", e.titulo)
    await db.flush()
    return {"id": e.id, "situacao": e.situacao}


@router.post("/entregas/{entrega_id}/avaliar")
async def avaliar_entrega(entrega_id: int, data: AvaliacaoIn, db: AsyncSession = Depends(get_db),
                          user: Usuario = Depends(get_current_user)):
    e, p = await _entrega(db, entrega_id)
    _exigir_gestao_projeto(user, p)
    if e.submetido_por_id == user.id:
        raise HTTPException(403, "Você enviou esta entrega: a aprovação deve ser feita por outro gestor autorizado")
    await _nao_eh_o_proprio(db, user, e.responsaveis or [], "avaliar")
    if e.situacao != "submetida":
        raise HTTPException(400, "Somente entregas enviadas para validação podem ser avaliadas")
    if not data.aprovar and not (data.parecer or "").strip():
        raise HTTPException(400, "Informe o parecer com os ajustes necessários")
    e.situacao = "aprovada" if data.aprovar else "devolvida"
    e.parecer = (data.parecer or "").strip() or None
    e.validado_por_id = user.id
    e.data_aprovacao = svc.hoje_br() if data.aprovar else None
    svc.registrar(db, user, "entrega", e.id, p.id, "aprovacao" if data.aprovar else "devolucao", e.titulo, e.parecer)
    await db.flush()
    return {"id": e.id, "situacao": e.situacao}


@router.get("/entregas")
async def listar_entregas(
    projeto_id: Optional[int] = None, professor_id: Optional[int] = None, situacao: Optional[str] = None,
    atrasadas: bool = False, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    esc = await svc.escopo_do_usuario(db, user)
    q = select(NrEntrega).order_by(NrEntrega.prazo.is_(None), NrEntrega.prazo)
    if not esc.tudo:
        q = q.where(NrEntrega.projeto_id.in_(list(esc.projeto_ids) or [0]))
    if projeto_id:
        q = q.where(NrEntrega.projeto_id == projeto_id)
    if situacao:
        q = q.where(NrEntrega.situacao == situacao)
    entregas = (await db.execute(q)).scalars().all()
    if professor_id:
        entregas = [e for e in entregas if professor_id in (e.responsaveis or [])]
    if not esc.tudo:
        entregas = [e for e in entregas if e.projeto_id in esc.coordena or esc.professor_id in (e.responsaveis or [])]
    hoje = svc.hoje_br()
    if atrasadas:
        entregas = [e for e in entregas if e.prazo and e.prazo < hoje and e.situacao != "aprovada"]
    profs = await _nomes_professores(db, [i for e in entregas for i in (e.responsaveis or [])])
    projetos = {p.id: p for p in (await db.execute(
        select(NrProjeto).where(NrProjeto.id.in_({e.projeto_id for e in entregas} or {0}))
    )).scalars().all()}
    anexos = await _anexos(db)
    return [_ser_entrega(e, profs, [a for a in anexos if a["entrega_id"] == e.id], projetos.get(e.projeto_id))
            for e in entregas]


# ── Apontamentos ──────────────────────────────────────────────────────────────

async def _apontamentos_ser(db: AsyncSession, aps: list[NrApontamento], horas_periodo: Optional[dict] = None) -> list[dict]:
    profs = await _nomes_professores(db, [a.professor_id for a in aps])
    usuarios = await _nomes_usuarios(db, [a.validado_por_id for a in aps])
    projetos = {p.id: {"nome": p.nome, "codigo": p.codigo} for p in (await db.execute(
        select(NrProjeto).where(NrProjeto.id.in_({a.projeto_id for a in aps} or {0}))
    )).scalars().all()}
    return [_ser_apontamento(a, profs, projetos, usuarios, (horas_periodo or {}).get(a.id)) for a in aps]


@router.get("/apontamentos")
async def listar_apontamentos(
    projeto_id: Optional[int] = None, professor_id: Optional[int] = None, situacao: Optional[str] = None,
    ini: Optional[date] = None, fim: Optional[date] = None, para_validar: bool = False,
    db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    esc = await svc.escopo_do_usuario(db, user)
    q = select(NrApontamento).order_by(NrApontamento.data_inicio.desc(), NrApontamento.id.desc())
    if not esc.tudo:
        q = q.where(NrApontamento.projeto_id.in_(list(esc.projeto_ids) or [0]))
    if projeto_id:
        q = q.where(NrApontamento.projeto_id == projeto_id)
    if professor_id:
        q = q.where(NrApontamento.professor_id == professor_id)
    if situacao:
        q = q.where(NrApontamento.situacao == situacao)
    if ini:
        q = q.where(NrApontamento.data_fim >= ini)
    if fim:
        q = q.where(NrApontamento.data_inicio <= fim)
    aps = (await db.execute(q.limit(2000))).scalars().all()
    if not esc.tudo:
        aps = [a for a in aps if a.projeto_id in esc.coordena or a.professor_id == esc.professor_id]
    if para_validar:
        aps = [a for a in aps if a.situacao == "enviado" and a.professor_id != esc.professor_id
               and a.criado_por_id != user.id]
    return await _apontamentos_ser(db, aps)


async def _checar_apontamento(db: AsyncSession, a: NrApontamento, ignorar_id: Optional[int] = None) -> list[str]:
    if not a.data_inicio or not a.data_fim or not a.horas or not (a.descricao or "").strip():
        raise HTTPException(400, "Informe período, horas e descrição da atividade")
    if a.data_fim < a.data_inicio:
        raise HTTPException(400, "O fim do período é anterior ao início")
    dias = (a.data_fim - a.data_inicio).days + 1
    if dias > MAX_DIAS_APONTAMENTO:
        raise HTTPException(400, f"O lançamento pode cobrir no máximo {MAX_DIAS_APONTAMENTO} dias (um por dia ou um por semana)")
    if a.data_inicio > svc.hoje_br():
        raise HTTPException(400, "Não é possível apontar horas futuras")
    if a.horas <= 0 or a.horas > 24 * dias:
        raise HTTPException(400, "Quantidade de horas inválida para o período")
    vinculos = (await db.execute(select(NrVinculo).options(selectinload(NrVinculo.projeto)).where(
        NrVinculo.projeto_id == a.projeto_id, NrVinculo.professor_id == a.professor_id,
        NrVinculo.situacao.in_(list(svc.VINCULO_OFICIAL))))).scalars().all()
    if not vinculos:
        raise HTTPException(400, "O professor não tem vínculo aprovado neste projeto")
    if a.entrega_id:
        e = await db.get(NrEntrega, a.entrega_id)
        if not e or e.projeto_id != a.projeto_id:
            raise HTTPException(400, "Entrega não pertence ao projeto")
    info = await svc.conflitos_apontamento(db, a, ignorar_id)
    if info["duplicados"]:
        d = info["duplicados"][0]
        raise HTTPException(409, "Já existe lançamento deste professor neste projeto cobrindo "
                                 f"{d.data_inicio.strftime('%d/%m')}–{d.data_fim.strftime('%d/%m')}: edite-o em vez de "
                                 "lançar de novo (evita contar as mesmas horas duas vezes)")
    avisos = list(info["avisos"])
    if not any(v.data_inicio <= a.data_fim and (svc.fim_efetivo_vinculo(v) is None or a.data_inicio <= svc.fim_efetivo_vinculo(v))
               for v in vinculos):
        avisos.append("O período está fora da vigência do vínculo do professor neste projeto.")
    return avisos


@router.post("/apontamentos")
async def criar_apontamento(data: ApontamentoIn, db: AsyncSession = Depends(get_db),
                            user: Usuario = Depends(get_current_user)):
    p = await _projeto(db, data.projeto_id) if data.projeto_id else None
    if not p:
        raise HTTPException(400, "Informe o projeto")
    eu = await svc.professor_do_usuario(db, user)
    prof_id = data.professor_id or (eu.id if eu else None)
    if not prof_id:
        raise HTTPException(400, "Seu usuário não está ligado a um professor (mesmo e-mail do cadastro de professores)")
    if not (_pode_gerir(user, p) or (eu and eu.id == prof_id)):
        raise HTTPException(403, "Você só pode apontar as próprias horas")
    a = NrApontamento(projeto_id=p.id, professor_id=prof_id, data_inicio=data.data_inicio,
                      data_fim=data.data_fim or data.data_inicio, horas=data.horas, descricao=(data.descricao or "").strip(),
                      entrega_id=data.entrega_id, evidencia=data.evidencia, situacao="rascunho", criado_por_id=user.id)
    avisos = await _checar_apontamento(db, a)
    if data.enviar:
        a.situacao = "enviado"
        a.enviado_em = svc.agora()
    db.add(a)
    await db.flush()
    svc.registrar(db, user, "apontamento", a.id, p.id, "envio" if data.enviar else "criacao",
                  f"{a.horas:g}h em {a.data_inicio.strftime('%d/%m/%Y')}" +
                  (f"–{a.data_fim.strftime('%d/%m/%Y')}" if a.data_fim != a.data_inicio else ""))
    await db.flush()
    return {"apontamento": (await _apontamentos_ser(db, [a]))[0], "avisos": avisos}


async def _meu_apontamento(db, user, apontamento_id) -> NrApontamento:
    a = await db.get(NrApontamento, apontamento_id)
    if not a:
        raise HTTPException(404, "Apontamento não encontrado")
    eu = await svc.professor_do_usuario(db, user)
    if not ((eu and eu.id == a.professor_id) or a.criado_por_id == user.id):
        raise HTTPException(403, "Somente quem lançou pode alterar o apontamento")
    if a.situacao not in {"rascunho", "devolvido"}:
        raise HTTPException(400, "Apontamento enviado ou aprovado não pode ser alterado")
    return a


@router.put("/apontamentos/{apontamento_id}")
async def editar_apontamento(apontamento_id: int, data: ApontamentoIn, db: AsyncSession = Depends(get_db),
                             user: Usuario = Depends(get_current_user)):
    a = await _meu_apontamento(db, user, apontamento_id)
    for k in ("data_inicio", "data_fim", "horas", "descricao", "entrega_id", "evidencia"):
        if k in data.model_fields_set:
            setattr(a, k, getattr(data, k))
    avisos = await _checar_apontamento(db, a, ignorar_id=a.id)
    if data.enviar:
        a.situacao = "enviado"
        a.enviado_em = svc.agora()
    svc.registrar(db, user, "apontamento", a.id, a.projeto_id, "envio" if data.enviar else "alteracao", f"{a.horas:g}h")
    await db.flush()
    return {"apontamento": (await _apontamentos_ser(db, [a]))[0], "avisos": avisos}


@router.delete("/apontamentos/{apontamento_id}", status_code=204)
async def excluir_apontamento(apontamento_id: int, db: AsyncSession = Depends(get_db),
                              user: Usuario = Depends(get_current_user)):
    a = await _meu_apontamento(db, user, apontamento_id)
    svc.registrar(db, user, "apontamento", a.id, a.projeto_id, "exclusao", f"{a.horas:g}h")
    await db.delete(a)


@router.post("/apontamentos/validar")
async def validar_apontamentos(data: ValidacaoIn, db: AsyncSession = Depends(get_db),
                               user: Usuario = Depends(get_current_user)):
    """Aprova ou devolve horas enviadas. Ninguém valida as próprias horas."""
    if not data.ids:
        raise HTTPException(400, "Nenhum apontamento selecionado")
    if not data.aprovar and not (data.parecer or "").strip():
        raise HTTPException(400, "Informe o motivo da devolução")
    eu = await svc.professor_do_usuario(db, user)
    aps = (await db.execute(select(NrApontamento).where(NrApontamento.id.in_(data.ids)))).scalars().all()
    projetos = {p.id: p for p in (await db.execute(
        select(NrProjeto).where(NrProjeto.id.in_({a.projeto_id for a in aps} or {0}))
    )).scalars().all()}
    for a in aps:
        if not _pode_gerir(user, projetos[a.projeto_id]):
            raise HTTPException(403, "Somente a gestão ou o responsável pelo projeto valida horas")
        if (eu and eu.id == a.professor_id) or a.criado_por_id == user.id:
            raise HTTPException(403, "Você não pode validar as próprias horas: encaminhe a outro gestor autorizado")
        if a.situacao != "enviado":
            raise HTTPException(400, "Somente apontamentos enviados podem ser validados")
    for a in aps:
        a.situacao = "aprovado" if data.aprovar else "devolvido"
        a.validado_por_id = user.id
        a.validado_em = svc.agora()
        a.parecer = (data.parecer or "").strip() or None
        svc.registrar(db, user, "apontamento", a.id, a.projeto_id, "aprovacao" if data.aprovar else "devolucao",
                      f"{a.horas:g}h de {a.data_inicio.strftime('%d/%m/%Y')}", a.parecer)
    await db.flush()
    return {"atualizados": len(aps)}


@router.post("/apontamentos/{apontamento_id}/enviar")
async def enviar_apontamento(apontamento_id: int, db: AsyncSession = Depends(get_db),
                             user: Usuario = Depends(get_current_user)):
    a = await _meu_apontamento(db, user, apontamento_id)
    a.situacao = "enviado"
    a.enviado_em = svc.agora()
    svc.registrar(db, user, "apontamento", a.id, a.projeto_id, "envio", f"{a.horas:g}h")
    await db.flush()
    return {"id": a.id, "situacao": a.situacao}


# ── Anexos ────────────────────────────────────────────────────────────────────

@router.post("/anexos")
async def enviar_anexo(
    projeto_id: int = Form(...), entrega_id: Optional[int] = Form(None), apontamento_id: Optional[int] = Form(None),
    arquivo: UploadFile = File(...), db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    p = await _projeto(db, projeto_id)
    esc = await _exigir_visao(db, user, p)
    if not _pode_gerir(user, p):
        # Professor anexa evidências às próprias entregas/apontamentos
        if entrega_id:
            e = await db.get(NrEntrega, entrega_id)
            if not e or esc.professor_id not in (e.responsaveis or []):
                raise HTTPException(403, "Sem permissão para anexar nesta entrega")
        elif apontamento_id:
            a = await db.get(NrApontamento, apontamento_id)
            if not a or a.professor_id != esc.professor_id:
                raise HTTPException(403, "Sem permissão para anexar neste apontamento")
        else:
            raise HTTPException(403, "Somente a gestão ou o responsável anexa arquivos ao projeto")
    conteudo = await arquivo.read()
    if len(conteudo) > LIMITE_ANEXO_MB * 1024 * 1024:
        raise HTTPException(400, f"Arquivo maior que {LIMITE_ANEXO_MB} MB: use um link de referência")
    an = NrAnexo(projeto_id=p.id, entrega_id=entrega_id, apontamento_id=apontamento_id,
                 nome=arquivo.filename or "arquivo", mime=arquivo.content_type, tamanho=len(conteudo),
                 conteudo=base64.b64encode(conteudo).decode(), enviado_por_id=user.id)
    db.add(an)
    await db.flush()
    svc.registrar(db, user, "anexo", an.id, p.id, "criacao", an.nome)
    return {"id": an.id, "nome": an.nome, "tamanho": an.tamanho}


@router.get("/anexos/{anexo_id}")
async def baixar_anexo(anexo_id: int, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    an = await db.get(NrAnexo, anexo_id)
    if not an:
        raise HTTPException(404, "Anexo não encontrado")
    await _exigir_visao(db, user, await _projeto(db, an.projeto_id))
    nome = an.nome.replace('"', "")
    return Response(content=base64.b64decode(an.conteudo), media_type=an.mime or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@router.delete("/anexos/{anexo_id}", status_code=204)
async def excluir_anexo(anexo_id: int, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    an = await db.get(NrAnexo, anexo_id)
    if not an:
        raise HTTPException(404, "Anexo não encontrado")
    p = await _projeto(db, an.projeto_id)
    if not (_pode_gerir(user, p) or an.enviado_por_id == user.id):
        raise HTTPException(403, "Sem permissão para excluir este anexo")
    svc.registrar(db, user, "anexo", an.id, p.id, "exclusao", an.nome)
    await db.delete(an)


# ── Afastamentos e outras alocações ───────────────────────────────────────────

def _exigir_gestao(user: Usuario):
    if not svc.eh_gestao(user):
        raise HTTPException(403, "Somente a gestão pode registrar afastamentos e outras alocações")


@router.get("/afastamentos")
async def listar_afastamentos(professor_id: Optional[int] = None, db: AsyncSession = Depends(get_db),
                              user: Usuario = Depends(get_current_user)):
    esc = await svc.escopo_do_usuario(db, user)
    q = select(NrAfastamento).options(selectinload(NrAfastamento.professor)).order_by(NrAfastamento.data_inicio.desc())
    if not esc.tudo:
        professor_id = esc.professor_id or 0
    if professor_id:
        q = q.where(NrAfastamento.professor_id == professor_id)
    return [{"id": a.id, "professor_id": a.professor_id, "professor_nome": a.professor.nome if a.professor else None,
             "tipo": a.tipo, "data_inicio": _iso(a.data_inicio), "data_fim": _iso(a.data_fim), "observacao": a.observacao}
            for a in (await db.execute(q)).scalars().all()]


@router.post("/afastamentos")
async def criar_afastamento(data: AfastamentoIn, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    _exigir_gestao(user)
    if data.data_fim < data.data_inicio:
        raise HTTPException(400, "O fim do afastamento é anterior ao início")
    prof = await db.get(Professor, data.professor_id)
    if not prof:
        raise HTTPException(400, "Professor não encontrado")
    a = NrAfastamento(**data.model_dump())
    db.add(a)
    await db.flush()
    svc.registrar(db, user, "afastamento", a.id, None, "criacao",
                  f"{prof.nome}: {a.tipo} {a.data_inicio.strftime('%d/%m/%Y')}–{a.data_fim.strftime('%d/%m/%Y')}")
    return {"id": a.id}


@router.delete("/afastamentos/{afastamento_id}", status_code=204)
async def excluir_afastamento(afastamento_id: int, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    _exigir_gestao(user)
    a = await db.get(NrAfastamento, afastamento_id)
    if not a:
        raise HTTPException(404, "Afastamento não encontrado")
    svc.registrar(db, user, "afastamento", a.id, None, "exclusao", f"{a.tipo} {a.data_inicio}")
    await db.delete(a)


@router.get("/outras-alocacoes")
async def listar_outras(professor_id: Optional[int] = None, db: AsyncSession = Depends(get_db),
                        user: Usuario = Depends(get_current_user)):
    esc = await svc.escopo_do_usuario(db, user)
    q = select(NrOutraAlocacao).options(selectinload(NrOutraAlocacao.professor)).order_by(NrOutraAlocacao.data_inicio.desc())
    if not esc.tudo:
        professor_id = esc.professor_id or 0
    if professor_id:
        q = q.where(NrOutraAlocacao.professor_id == professor_id)
    return [{"id": o.id, "professor_id": o.professor_id, "professor_nome": o.professor.nome if o.professor else None,
             "descricao": o.descricao, "data_inicio": _iso(o.data_inicio), "data_fim": _iso(o.data_fim),
             "horas_semanais": o.horas_semanais} for o in (await db.execute(q)).scalars().all()]


@router.post("/outras-alocacoes")
async def criar_outra(data: OutraAlocacaoIn, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    _exigir_gestao(user)
    if data.data_fim and data.data_fim < data.data_inicio:
        raise HTTPException(400, "O fim é anterior ao início")
    if data.horas_semanais <= 0 or data.horas_semanais > 60:
        raise HTTPException(400, "Carga semanal inválida")
    prof = await db.get(Professor, data.professor_id)
    if not prof or not data.descricao.strip():
        raise HTTPException(400, "Informe professor e descrição")
    o = NrOutraAlocacao(**data.model_dump())
    db.add(o)
    await db.flush()
    svc.registrar(db, user, "outra_alocacao", o.id, None, "criacao", f"{prof.nome}: {o.descricao} ({o.horas_semanais:g}h/sem)")
    return {"id": o.id}


@router.delete("/outras-alocacoes/{alocacao_id}", status_code=204)
async def excluir_outra(alocacao_id: int, db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    _exigir_gestao(user)
    o = await db.get(NrOutraAlocacao, alocacao_id)
    if not o:
        raise HTTPException(404, "Alocação não encontrada")
    svc.registrar(db, user, "outra_alocacao", o.id, None, "exclusao", o.descricao)
    await db.delete(o)


# ── Dashboard, visão do professor e histórico ─────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    ini: Optional[date] = None, fim: Optional[date] = None, professor_id: Optional[int] = None,
    unidade: Optional[str] = None, categoria_id: Optional[int] = None, projeto_id: Optional[int] = None,
    responsavel_id: Optional[int] = None, situacao: Optional[str] = None,
    db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    ini, fim = _periodo(ini, fim)
    f = _filtros(professor_id, unidade, categoria_id, projeto_id, responsavel_id, situacao)
    esc = await svc.escopo_do_usuario(db, user)
    res = await svc.calcular(db, ini, fim, f, esc)
    linhas = res["linhas"]
    projetos = res["projetos"]
    hoje = svc.hoje_br()
    profs_vinc = {v.professor_id for v in res["vinculos"] if v.situacao in svc.VINCULO_OFICIAL
                  and v.data_inicio <= fim and (svc.fim_efetivo_vinculo(v) is None or svc.fim_efetivo_vinculo(v) >= ini)}
    nomes = await _nomes_professores(db, [i for e in res["entregas_periodo"] + res["entregas_atrasadas"] for i in (e.responsaveis or [])])
    aprovadas_periodo = [e for e in res["entregas_periodo"] if e.situacao == "aprovada"]
    soma = lambda k: round(sum(l[k] for l in linhas), 2)  # noqa: E731
    return {
        "periodo": {"inicio": ini.isoformat(), "fim": fim.isoformat(), "dias_uteis": len(res["cal"].dias_uteis(ini, fim))},
        "indicadores": {
            "professores_vinculados": len(profs_vinc),
            "projetos_andamento": sum(1 for p in projetos.values() if p.situacao == "em_andamento"),
            "horas_previstas": soma("nr_prevista"), "horas_propostas": soma("nr_proposta"),
            "horas_informadas": soma("nr_informada"), "horas_validadas": soma("nr_validada"),
            "horas_pendentes": soma("nr_pendente"),
            "saldo_disponivel": round(sum(max(0, l["saldo_previsto"]) for l in linhas), 2),
            "professores_sobrecarga": sum(1 for l in linhas if l["sobrecarga"]),
            "entregas_periodo": len(res["entregas_periodo"]), "entregas_aprovadas": len(aprovadas_periodo),
            "entregas_atrasadas": len(res["entregas_atrasadas"]),
        },
        "professores": linhas,
        "por_projeto": res["por_projeto"],
        "por_categoria": res["por_categoria"],
        "evolucao": res["evolucao"],
        "projetos_atrasados": res["projetos_atrasados"],
        "alertas": await svc.alertas(db, res, ini, fim),
        # Registros que compõem os indicadores (detalhe ao clicar)
        "vinculos": [_ser_vinculo(v, res["prev_vinc"].get(v.id)) for v in res["vinculos"]],
        "apontamentos": await _apontamentos_ser(db, res["apontamentos"], res["inf_ap"]),
        "entregas": [_ser_entrega(e, nomes, None, projetos.get(e.projeto_id))
                     for e in {e.id: e for e in res["entregas_periodo"] + res["entregas_atrasadas"]}.values()],
        "projetos": [_ser_projeto_resumo(p) for p in projetos.values()],
        "unidade_tempo": "hora-relógio",
        "hoje": hoje.isoformat(),
    }


@router.get("/professores/{professor_id}/visao")
async def visao_professor(professor_id: int, ini: Optional[date] = None, fim: Optional[date] = None,
                          db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    prof = (await db.execute(
        select(Professor).options(selectinload(Professor.atuacoes)).where(Professor.id == professor_id)
    )).scalar_one_or_none()
    if not prof:
        raise HTTPException(404, "Professor não encontrado")
    esc = await svc.escopo_do_usuario(db, user)
    if not esc.tudo and esc.professor_id != professor_id:
        participa = (await db.execute(select(func.count(NrVinculo.id)).where(
            NrVinculo.professor_id == professor_id, NrVinculo.projeto_id.in_(list(esc.coordena) or [0])))).scalar()
        if not participa:
            raise HTTPException(403, "Sem permissão para consultar este professor")
    ini, fim = _periodo(ini, fim)
    res = await svc.calcular(db, ini, fim, svc.Filtros(professor_id=professor_id), svc.Escopo(tudo=True))
    linha = res["linhas"][0] if res["linhas"] else None
    regencia = await calcular_regencia_professor(prof, db, ini, fim)
    todos = (await db.execute(
        select(NrVinculo).options(selectinload(NrVinculo.projeto), selectinload(NrVinculo.periodos),
                                  selectinload(NrVinculo.gestor), selectinload(NrVinculo.professor))
        .where(NrVinculo.professor_id == professor_id).order_by(NrVinculo.data_inicio.desc())
    )).scalars().all()
    hoje = svc.hoje_br()
    entregas = [e for e in (await db.execute(select(NrEntrega).order_by(NrEntrega.prazo))).scalars().all()
                if professor_id in (e.responsaveis or [])]
    projetos = {p.id: p for p in (await db.execute(
        select(NrProjeto).where(NrProjeto.id.in_({e.projeto_id for e in entregas} or {0})))).scalars().all()}
    nomes = {professor_id: prof.nome}
    alerts = [a for a in await svc.alertas(db, res, ini, fim) if a.get("professor_id") in (None, professor_id)]
    return {
        "professor": {"id": prof.id, "nome": prof.nome, "foto": prof.foto, "tipo": prof.tipo, "area": prof.area,
                      "horas_semanais": prof.horas_contratadas, "email": prof.email},
        "periodo": {"inicio": ini.isoformat(), "fim": fim.isoformat()},
        "carga": linha,
        "regencia": regencia,
        "vinculos_ativos": [_ser_vinculo(v, res["prev_vinc"].get(v.id)) for v in todos
                            if v.situacao in {"aprovada", "proposta"} and (v.data_fim is None or v.data_fim >= hoje)],
        "historico_participacao": [_ser_vinculo(v) for v in todos],
        "proximas_entregas": [_ser_entrega(e, nomes, None, projetos.get(e.projeto_id)) for e in entregas
                              if e.situacao != "aprovada" and e.prazo and e.prazo >= hoje][:10],
        "entregas_atrasadas": [_ser_entrega(e, nomes, None, projetos.get(e.projeto_id)) for e in entregas
                               if e.situacao != "aprovada" and e.prazo and e.prazo < hoje],
        "apontamentos": await _apontamentos_ser(db, res["apontamentos"], res["inf_ap"]),
        "alertas": alerts,
    }


@router.get("/historico")
async def historico(projeto_id: Optional[int] = None, entidade: Optional[str] = None, limite: int = 300,
                    db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user)):
    esc = await svc.escopo_do_usuario(db, user)
    q = select(NrHistorico).order_by(NrHistorico.id.desc()).limit(min(limite, 1000))
    if projeto_id:
        q = q.where(NrHistorico.projeto_id == projeto_id)
    if entidade:
        q = q.where(NrHistorico.entidade == entidade)
    if not esc.tudo:
        q = q.where(NrHistorico.projeto_id.in_(list(esc.projeto_ids) or [0]))
    return [{"id": h.id, "projeto_id": h.projeto_id, "entidade": h.entidade, "acao": h.acao, "detalhe": h.detalhe,
             "justificativa": h.justificativa, "usuario": h.usuario_nome,
             "criado_em": h.criado_em.isoformat() if h.criado_em else None}
            for h in (await db.execute(q)).scalars().all()]


# ── Relatórios ────────────────────────────────────────────────────────────────

def _tabelas_relatorio(tipo: str, res: dict, cfg_unid: str = "h") -> list[tuple[str, list[str], list[list]]]:
    """(título, cabeçalho, linhas) — o mesmo conteúdo para Excel e PDF."""
    prof_cab = ["Professor", "Carga disponível", "Reserva planej.", "Regência prevista", "Regência realizada",
                "Regência %", "Não regência prevista", "Não regência proposta", "Não regência informada",
                "Não regência validada", "Outras alocações", "Saldo previsto", "Entregas atrasadas"]
    prof_lin = [[l["nome"], l["disponivel"], l["reserva_planejamento"], l["regencia_prevista"], l["regencia_realizada"],
                 l["regencia_pct"], l["nr_prevista"], l["nr_proposta"], l["nr_informada"], l["nr_validada"],
                 l["outras_alocacoes"], l["saldo_previsto"], l["entregas_atrasadas"]] for l in res["linhas"]]
    proj_cab = ["Código", "Projeto", "Categoria", "Situação", "Professores", "Previstas", "Propostas", "Informadas",
                "Validadas", "Progresso"]
    proj_lin = [[p["codigo"], p["nome"], p["categoria"], svc.SITUACAO_PROJETO.get(p["situacao"], p["situacao"]),
                 p["professores"], p["previstas"], p["propostas"], p["informadas"], p["validadas"],
                 "não definido" if p["progresso"] is None else f"{p['progresso']:.0f}%"] for p in res["por_projeto"]]
    cat_cab = ["Categoria", "Previstas", "Informadas", "Validadas"]
    cat_lin = [[c["categoria"], c["previstas"], c["informadas"], c["validadas"]] for c in res["por_categoria"]]
    ent_cab = ["Projeto", "Entrega", "Prazo", "Situação"]
    projetos = res["projetos"]
    ent_lin = [[projetos[e.projeto_id].nome if e.projeto_id in projetos else "", e.titulo,
                e.prazo.strftime("%d/%m/%Y") if e.prazo else "", svc.SITUACAO_ENTREGA.get(e.situacao, e.situacao)]
               for e in {e.id: e for e in res["entregas_periodo"] + res["entregas_atrasadas"]}.values()]
    if tipo == "professor":
        return [("Atuação por professor", prof_cab, prof_lin)]
    if tipo == "projeto":
        return [("Horas por projeto", proj_cab, proj_lin), ("Entregas do período e atrasadas", ent_cab, ent_lin)]
    if tipo == "categoria":
        return [("Horas por categoria", cat_cab, cat_lin)]
    return [("Atuação por professor", prof_cab, prof_lin), ("Horas por projeto", proj_cab, proj_lin),
            ("Horas por categoria", cat_cab, cat_lin), ("Entregas do período e atrasadas", ent_cab, ent_lin)]


@router.get("/relatorios/exportar")
async def exportar_relatorio(
    formato: str = "xlsx", tipo: str = "consolidado",
    ini: Optional[date] = None, fim: Optional[date] = None, professor_id: Optional[int] = None,
    unidade: Optional[str] = None, categoria_id: Optional[int] = None, projeto_id: Optional[int] = None,
    responsavel_id: Optional[int] = None, situacao: Optional[str] = None,
    db: AsyncSession = Depends(get_db), user: Usuario = Depends(get_current_user),
):
    if formato not in {"xlsx", "pdf"} or tipo not in {"professor", "projeto", "categoria", "consolidado"}:
        raise HTTPException(400, "Formato ou tipo de relatório inválido")
    ini, fim = _periodo(ini, fim)
    f = _filtros(professor_id, unidade, categoria_id, projeto_id, responsavel_id, situacao)
    esc = await svc.escopo_do_usuario(db, user)
    res = await svc.calcular(db, ini, fim, f, esc)
    tabelas = _tabelas_relatorio(tipo, res)

    # Filtros legíveis
    filtros = f.descricao()
    if professor_id:
        filtros.append(f"Professor: {(await _nomes_professores(db, [professor_id])).get(professor_id, professor_id)}")
    if categoria_id:
        c = await db.get(NrCategoria, categoria_id)
        filtros.append(f"Categoria: {c.nome if c else categoria_id}")
    if projeto_id:
        p = await db.get(NrProjeto, projeto_id)
        filtros.append(f"Projeto: {p.codigo + ' ' + p.nome if p else projeto_id}")
    if responsavel_id:
        filtros.append(f"Responsável: {(await _nomes_usuarios(db, [responsavel_id])).get(responsavel_id, responsavel_id)}")
    titulo = {"professor": "Relatório por professor", "projeto": "Relatório por projeto",
              "categoria": "Relatório por categoria", "consolidado": "Relatório consolidado da atuação docente"}[tipo]
    cab = [
        f"Período: {ini.strftime('%d/%m/%Y')} a {fim.strftime('%d/%m/%Y')} — horas-relógio",
        "Filtros: " + ("; ".join(filtros) if filtros else "nenhum"),
        "Previstas = vínculos aprovados; propostas = aguardando aprovação; informadas = lançadas pelo professor "
        "(enviadas ou aprovadas); validadas = aprovadas pelo gestor. Regência = aulas agendadas + realizadas "
        "(realizada só as realizadas), mesmo cálculo da aba Regência.",
    ]
    nome_arq = f"nao_regencia_{tipo}_{ini.isoformat()}_{fim.isoformat()}"

    if formato == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter
        wb = Workbook()
        wb.remove(wb.active)
        for nome, cabecalho, linhas in tabelas:
            ws = wb.create_sheet(nome[:31])
            ws.append([titulo])
            ws["A1"].font = Font(bold=True, size=13)
            for c in cab:
                ws.append([c])
            ws.append([])
            ws.append(cabecalho)
            hr = ws.max_row
            for i in range(1, len(cabecalho) + 1):
                cel = ws.cell(row=hr, column=i)
                cel.font = Font(bold=True, color="FFFFFF")
                cel.fill = PatternFill("solid", fgColor="003B8E")
                cel.alignment = Alignment(wrap_text=True, vertical="center")
            for l in linhas:
                ws.append(l)
            for i, h in enumerate(cabecalho, 1):
                ws.column_dimensions[get_column_letter(i)].width = max(12, min(45, len(str(h)) + 4)) if i > 1 else 38
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{nome_arq}.xlsx"'})

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=1.2 * cm, rightMargin=1.2 * cm,
                            topMargin=1.2 * cm, bottomMargin=1.2 * cm, title=titulo)
    st = getSampleStyleSheet()
    pequeno = st["BodyText"].clone("pequeno", fontSize=7, leading=8.5)
    corpo = [Paragraph(titulo, st["Title"])]
    for c in cab:
        corpo.append(Paragraph(c, st["BodyText"]))
    for nome, cabecalho, linhas in tabelas:
        corpo += [Spacer(1, 10), Paragraph(nome, st["Heading3"])]
        if not linhas:
            corpo.append(Paragraph("Sem registros no período.", st["BodyText"]))
            continue
        fmt = lambda v: f"{v:.1f}".replace(".", ",") if isinstance(v, float) else str(v if v is not None else "")  # noqa: E731
        dados = [[Paragraph(f"<b>{h}</b>", pequeno) for h in cabecalho]] + \
                [[Paragraph(fmt(v), pequeno) for v in l] for l in linhas]
        largura = doc.width
        primeira = largura * (0.22 if len(cabecalho) > 6 else 0.35)
        cols = [primeira] + [(largura - primeira) / (len(cabecalho) - 1)] * (len(cabecalho) - 1)
        t = Table(dados, colWidths=cols, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF8")),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#C9D3E3")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FC")]),
        ]))
        corpo.append(t)
    doc.build(corpo)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{nome_arq}.pdf"'})
