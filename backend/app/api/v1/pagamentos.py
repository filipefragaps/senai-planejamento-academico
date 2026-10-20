"""
Controle de Pagamento de Docentes / Prestadores.
Fluxo: Pendente → Encaminhado → Pago. Reversão apenas por admin.
"""
import io
from datetime import datetime, date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, require_admin
from app.database import get_db
from app.models.aula import Aula
from app.models.contrato import ContratoDocente
from app.models.curso import Curso
from app.models.evento import Evento
from app.models.oferta import OfertaCurso
from app.models.pagamento import HistoricoPagamento, PagamentoAula
from app.models.professor import Professor
from app.models.unidade_curricular import UnidadeCurricular
from app.models.diario import DiarioAula
from app.models.usuario import Usuario

router = APIRouter(prefix="/pagamentos", tags=["Controle de Pagamentos"])

TIPOS_PAGAMENTO = {"PJ", "RPA", "Inclusão em Folha"}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _horas(inicio: time, fim: time) -> float:
    mins = (fim.hour * 60 + fim.minute) - (inicio.hour * 60 + inicio.minute)
    return round(max(mins, 0) / 60, 2)


def _aula_out(
    aula: Aula,
    professor: Professor,
    evento: Evento,
    pagamento: Optional[PagamentoAula],
    tem_diario: bool = False,
    diario_conteudo: Optional[str] = None,
) -> dict:
    uc_nome = None
    if aula.unidade_curricular:
        uc_nome = aula.unidade_curricular.nome
    elif aula.uc_nome_original:
        uc_nome = aula.uc_nome_original

    horas = _horas(aula.horario_inicio, aula.horario_fim)

    return {
        "id": aula.id,
        "data": aula.data.isoformat(),
        "horario_inicio": aula.horario_inicio.strftime("%H:%M"),
        "horario_fim": aula.horario_fim.strftime("%H:%M"),
        "horas": horas,
        "professor_id": professor.id,
        "professor_nome": professor.nome,
        "professor_tipo": professor.tipo,
        "evento_id": evento.id,
        "evento_nome": evento.nome_turma,
        "uc_nome": uc_nome or "—",
        "tipo_contrato": aula.tipo_contrato or professor.tipo,
        # pagamento
        "status_pagamento": pagamento.status if pagamento else "pendente",
        "pagamento_id": pagamento.id if pagamento else None,
        "contrato_id": pagamento.contrato_id if pagamento else None,
        "contrato_numero": pagamento.contrato.numero_contrato if pagamento and pagamento.contrato else None,
        "valor_pagamento": float(pagamento.valor) if pagamento else None,
        "encaminhado_em": pagamento.encaminhado_em.isoformat() if pagamento else None,
        "confirmado_em": pagamento.confirmado_em.isoformat() if pagamento and pagamento.confirmado_em else None,
        "tem_diario": tem_diario,
        "diario_conteudo": diario_conteudo,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/aulas")
async def listar_aulas_pagamento(
    professor_id: Optional[int] = Query(default=None),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    status: Optional[str] = Query(default=None),  # pendente | encaminhado | pago | todos
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Lista aulas de professores PJ/RPA/Inclusão em Folha com status de pagamento.
    """
    # Query base: aulas com professor dos tipos de pagamento
    q = (
        select(Aula)
        .join(Professor, Aula.professor_id == Professor.id)
        .join(Evento, Aula.evento_id == Evento.id)
        .options(
            selectinload(Aula.professor),
            selectinload(Aula.evento),
            selectinload(Aula.unidade_curricular),
        )
        .where(Professor.tipo.in_(TIPOS_PAGAMENTO))
        .where(Aula.status.notin_(["Cancelada", "Remarcada"]))
    )

    if professor_id:
        q = q.where(Aula.professor_id == professor_id)
    if data_inicio:
        q = q.where(Aula.data >= data_inicio)
    if data_fim:
        q = q.where(Aula.data <= data_fim)

    q = q.order_by(Aula.data.asc(), Aula.horario_inicio.asc())
    result = await db.execute(q)
    aulas = result.scalars().all()

    # Busca pagamentos ativos (não revertidos)
    aula_ids = [a.id for a in aulas]
    pag_map: dict[int, PagamentoAula] = {}
    if aula_ids:
        pag_res = await db.execute(
            select(PagamentoAula)
            .options(selectinload(PagamentoAula.contrato))
            .where(
                PagamentoAula.aula_id.in_(aula_ids),
                PagamentoAula.status.in_(["encaminhado", "pago"]),
            )
        )
        for p in pag_res.scalars().all():
            pag_map[p.aula_id] = p

    # Verifica quais aulas possuem diário vinculado e busca conteúdo (col. I)
    diario_map: dict[int, str | None] = {}
    if aula_ids:
        diario_res = await db.execute(
            select(DiarioAula.aula_id, DiarioAula.conteudo).where(
                DiarioAula.aula_id.in_(aula_ids),
                DiarioAula.aula_id.isnot(None),
            )
        )
        diario_map = {row[0]: row[1] for row in diario_res.all()}

    rows = [_aula_out(a, a.professor, a.evento, pag_map.get(a.id), a.id in diario_map, diario_map.get(a.id)) for a in aulas]

    # Filtro por status de pagamento
    if status and status != "todos":
        rows = [r for r in rows if r["status_pagamento"] == status]

    return rows


class EncaminharRequest(BaseModel):
    aula_ids: list[int]
    contrato_id: int


@router.post("/encaminhar")
async def encaminhar_pagamento(
    body: EncaminharRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """
    Encaminha aulas selecionadas para pagamento vinculando-as ao contrato.
    Apenas aulas com status 'pendente' podem ser encaminhadas.
    """
    if current_user.perfil not in ("admin", "coordenador", "analista"):
        raise HTTPException(403, "Sem permissão para encaminhar pagamentos")

    # Verifica contrato
    c_res = await db.execute(select(ContratoDocente).where(ContratoDocente.id == body.contrato_id))
    contrato = c_res.scalar_one_or_none()
    if not contrato:
        raise HTTPException(404, "Contrato não encontrado")
    if not contrato.ativo:
        raise HTTPException(400, "Contrato inativo")

    valor_hora = float(contrato.valor_hora)
    encaminhados = []
    ja_processadas = []

    for aula_id in body.aula_ids:
        # Verifica se já tem pagamento ativo
        pag_res = await db.execute(
            select(PagamentoAula).where(
                PagamentoAula.aula_id == aula_id,
                PagamentoAula.status.in_(["encaminhado", "pago"]),
            )
        )
        if pag_res.scalar_one_or_none():
            ja_processadas.append(aula_id)
            continue

        aula_res = await db.execute(
            select(Aula)
            .options(selectinload(Aula.professor))
            .where(Aula.id == aula_id)
        )
        aula = aula_res.scalar_one_or_none()
        if not aula:
            continue

        horas = _horas(aula.horario_inicio, aula.horario_fim)
        valor = round(horas * valor_hora, 2)

        pag = PagamentoAula(
            aula_id=aula_id,
            contrato_id=body.contrato_id,
            status="encaminhado",
            encaminhado_por_id=current_user.id,
            horas=horas,
            valor=valor,
        )
        db.add(pag)
        await db.flush()

        hist = HistoricoPagamento(
            pagamento_id=pag.id,
            usuario_id=current_user.id,
            acao="encaminhado",
            horas=horas,
            valor=valor,
        )
        db.add(hist)
        encaminhados.append(aula_id)

    await db.commit()
    return {
        "encaminhados": len(encaminhados),
        "ja_processadas": ja_processadas,
        "aulas_encaminhadas": encaminhados,
    }


@router.get("/encaminhados")
async def listar_encaminhados(
    professor_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Lista todos os pagamentos encaminhados aguardando confirmação."""
    if current_user.perfil not in ("admin", "coordenador", "analista"):
        raise HTTPException(403, "Sem permissão")

    q = (
        select(PagamentoAula)
        .options(
            selectinload(PagamentoAula.aula).selectinload(Aula.professor),
            selectinload(PagamentoAula.aula).selectinload(Aula.evento),
            selectinload(PagamentoAula.aula).selectinload(Aula.unidade_curricular),
            selectinload(PagamentoAula.contrato),
            selectinload(PagamentoAula.encaminhado_por),
        )
        .where(PagamentoAula.status == "encaminhado")
        .order_by(PagamentoAula.encaminhado_em.desc())
    )
    if professor_id:
        q = q.join(Aula, PagamentoAula.aula_id == Aula.id).where(Aula.professor_id == professor_id)

    res = await db.execute(q)
    pagamentos = res.scalars().all()

    return [
        {
            "id": p.id,
            "aula_id": p.aula_id,
            "contrato_id": p.contrato_id,
            "contrato_numero": p.contrato.numero_contrato if p.contrato else None,
            "status": p.status,
            "horas": float(p.horas),
            "valor": float(p.valor),
            "encaminhado_em": p.encaminhado_em.isoformat(),
            "encaminhado_por": p.encaminhado_por.nome if p.encaminhado_por else None,
            "professor_id": p.aula.professor_id,
            "professor_nome": p.aula.professor.nome if p.aula.professor else None,
            "professor_tipo": p.aula.professor.tipo if p.aula.professor else None,
            "aula_data": p.aula.data.isoformat() if p.aula else None,
            "aula_horario": f"{p.aula.horario_inicio.strftime('%H:%M')}–{p.aula.horario_fim.strftime('%H:%M')}" if p.aula else None,
            "evento_nome": p.aula.evento.nome_turma if p.aula and p.aula.evento else None,
            "uc_nome": (
                p.aula.unidade_curricular.nome if p.aula and p.aula.unidade_curricular
                else (p.aula.uc_nome_original if p.aula else None)
            ) or "—",
        }
        for p in pagamentos
    ]


class ConfirmarRequest(BaseModel):
    pagamento_ids: list[int]


@router.post("/confirmar")
async def confirmar_pagamentos(
    body: ConfirmarRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_admin),
):
    """Confirma pagamentos (status encaminhado → pago). Apenas admin."""
    confirmados = []
    for pid in body.pagamento_ids:
        res = await db.execute(select(PagamentoAula).where(PagamentoAula.id == pid))
        p = res.scalar_one_or_none()
        if not p or p.status != "encaminhado":
            continue
        p.status = "pago"
        p.confirmado_por_id = current_user.id
        p.confirmado_em = datetime.utcnow()

        hist = HistoricoPagamento(
            pagamento_id=p.id,
            usuario_id=current_user.id,
            acao="confirmado",
            horas=p.horas,
            valor=p.valor,
        )
        db.add(hist)
        confirmados.append(pid)

    await db.commit()
    return {"confirmados": len(confirmados), "ids": confirmados}


class ReverterRequest(BaseModel):
    observacao: Optional[str] = None


@router.post("/reverter/{pagamento_id}")
async def reverter_pagamento(
    pagamento_id: int,
    body: ReverterRequest = ReverterRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_admin),
):
    """Reverte um pagamento (pago ou encaminhado → revertido). Apenas admin."""
    res = await db.execute(select(PagamentoAula).where(PagamentoAula.id == pagamento_id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Pagamento não encontrado")
    if p.status == "revertido":
        raise HTTPException(400, "Pagamento já foi revertido")

    status_anterior = p.status
    p.status = "revertido"

    hist = HistoricoPagamento(
        pagamento_id=p.id,
        usuario_id=current_user.id,
        acao="revertido",
        horas=p.horas,
        valor=p.valor,
        observacao=body.observacao,
    )
    db.add(hist)
    await db.commit()
    return {"revertido": pagamento_id, "status_anterior": status_anterior}


@router.get("/historico")
async def historico_pagamentos(
    professor_id: Optional[int] = Query(default=None),
    pagamento_id: Optional[int] = Query(default=None),
    limit: int = Query(default=100, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Histórico de todas as movimentações (auditoria)."""
    if current_user.perfil not in ("admin", "coordenador", "analista"):
        raise HTTPException(403, "Sem permissão")

    q = (
        select(HistoricoPagamento)
        .options(
            selectinload(HistoricoPagamento.usuario),
            selectinload(HistoricoPagamento.pagamento)
            .selectinload(PagamentoAula.aula)
            .selectinload(Aula.professor),
            selectinload(HistoricoPagamento.pagamento)
            .selectinload(PagamentoAula.aula)
            .selectinload(Aula.evento),
            selectinload(HistoricoPagamento.pagamento)
            .selectinload(PagamentoAula.contrato),
        )
        .order_by(HistoricoPagamento.criado_em.desc())
        .limit(limit)
    )
    if pagamento_id:
        q = q.where(HistoricoPagamento.pagamento_id == pagamento_id)
    if professor_id:
        q = q.join(PagamentoAula, HistoricoPagamento.pagamento_id == PagamentoAula.id).join(
            Aula, PagamentoAula.aula_id == Aula.id
        ).where(Aula.professor_id == professor_id)

    res = await db.execute(q)
    items = res.scalars().all()

    return [
        {
            "id": h.id,
            "pagamento_id": h.pagamento_id,
            "acao": h.acao,
            "horas": float(h.horas),
            "valor": float(h.valor),
            "observacao": h.observacao,
            "criado_em": h.criado_em.isoformat(),
            "usuario": h.usuario.nome if h.usuario else None,
            "professor": h.pagamento.aula.professor.nome if h.pagamento and h.pagamento.aula and h.pagamento.aula.professor else None,
            "evento": h.pagamento.aula.evento.nome_turma if h.pagamento and h.pagamento.aula and h.pagamento.aula.evento else None,
            "contrato": h.pagamento.contrato.numero_contrato if h.pagamento and h.pagamento.contrato else None,
            "aula_data": h.pagamento.aula.data.isoformat() if h.pagamento and h.pagamento.aula else None,
        }
        for h in items
    ]


@router.get("/relatorio/excel")
async def relatorio_excel(
    status: str = Query(default="encaminhado", description="encaminhado | pago | todos"),
    professor_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Gera Boletim de Medição (uma aba por docente/contrato) para o Financeiro."""
    if current_user.perfil not in ("admin", "coordenador", "analista"):
        raise HTTPException(403, "Sem permissão")

    filtros = [PagamentoAula.status != "revertido"]
    if status != "todos":
        filtros.append(PagamentoAula.status == status)

    q = (
        select(PagamentoAula)
        .options(
            selectinload(PagamentoAula.aula).selectinload(Aula.professor),
            selectinload(PagamentoAula.aula).selectinload(Aula.evento),
            selectinload(PagamentoAula.aula).selectinload(Aula.unidade_curricular),
            selectinload(PagamentoAula.contrato),
        )
        .where(*filtros)
    )
    if professor_id:
        q = q.join(Aula, PagamentoAula.aula_id == Aula.id).where(Aula.professor_id == professor_id)

    res = await db.execute(q)
    pagamentos = [p for p in res.scalars().all() if p.aula]

    # Dados complementares por evento: oferta (curso, turno, modalidade, coordenador) e curso
    eventos = {p.aula.evento.id: p.aula.evento for p in pagamentos if p.aula.evento}
    ids_oferta = {e.oferta_id for e in eventos.values() if e.oferta_id}
    codigos = {_codigo_evento(e.nome_turma) for e in eventos.values() if not e.oferta_id}
    ofertas_por_id: dict[int, OfertaCurso] = {}
    ofertas_por_codigo: dict[str, OfertaCurso] = {}
    if ids_oferta:
        r = await db.execute(select(OfertaCurso).where(OfertaCurso.id.in_(ids_oferta)))
        ofertas_por_id = {o.id: o for o in r.scalars().all()}
    if codigos:
        r = await db.execute(select(OfertaCurso).where(OfertaCurso.codigo_evento.in_(codigos)))
        ofertas_por_codigo = {o.codigo_evento: o for o in r.scalars().all()}
    ids_curso = {e.curso_id for e in eventos.values() if e.curso_id}
    cursos: dict[int, Curso] = {}
    if ids_curso:
        r = await db.execute(select(Curso).where(Curso.id.in_(ids_curso)))
        cursos = {c.id: c for c in r.scalars().all()}

    info_evento: dict[int, dict] = {}
    for e in eventos.values():
        of = ofertas_por_id.get(e.oferta_id) if e.oferta_id else ofertas_por_codigo.get(_codigo_evento(e.nome_turma))
        curso = cursos.get(e.curso_id) if e.curso_id else None
        info_evento[e.id] = {
            "codigo": (of.codigo_evento if of else None) or _codigo_evento(e.nome_turma),
            "curso": (of.nome_curso if of else None) or (curso.nome if curso else None) or e.disciplina,
            "turno": of.turno if of else None,
            "modalidade": (of.modalidade if of else None) or e.tipo_modalidade or e.modalidade,
            "coordenador": of.coordenador if of else None,
            "sala": e.sala,
        }

    wb = _gerar_boletim_medicao(pagamentos, info_evento)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"boletim_medicao_{status}_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _codigo_evento(nome_turma: str | None) -> str:
    """'1089644 – SOLDAGEM ...' → '1089644'."""
    nome = (nome_turma or "").strip()
    for sep in (" – ", " - ", " — "):
        if sep in nome:
            return nome.split(sep, 1)[0].strip()
    return nome


TURNOS = {"manhã": "MATUTINO", "manha": "MATUTINO", "tarde": "VESPERTINO", "noite": "NOTURNO"}


def _turno(aula: Aula, turno_oferta: str | None) -> str:
    t = aula.turno or turno_oferta
    if not t:
        h = aula.horario_inicio.hour
        t = "manhã" if h < 12 else "tarde" if h < 18 else "noite"
    return TURNOS.get(t.strip().lower(), t.upper())


def _hhmm(horas: float) -> str:
    mins = round(horas * 60)
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _gerar_boletim_medicao(pagamentos: list[PagamentoAula], info_evento: dict[int, dict]):
    """Uma aba por (docente, contrato) no layout do Boletim de Medição."""
    from openpyxl import Workbook
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    wb.remove(wb.active)

    AZUL = PatternFill("solid", fgColor="4472C4")
    thin = Side(style="thin", color="000000")
    medium = Side(style="medium", color="000000")
    BORDA = Border(left=thin, right=thin, top=thin, bottom=thin)
    F = Font(name="Calibri", size=8)
    FB = Font(name="Calibri", size=8, bold=True)
    CENTRO = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ESQ = Alignment(horizontal="left", vertical="center")
    DIR = Alignment(horizontal="right", vertical="center")
    MOEDA = '"R$" #,##0.00'

    # A=nº  B=data  C=evento  D=curso  E=CH  F=turno  G=UC  H=ambiente  I=unit  J=total  K=status
    LARGURAS = [3, 20, 10, 30, 14, 16, 48, 18, 13, 14, 18]

    def celula(ws, ref, valor=None, font=F, align=CENTRO, fmt=None, fill=None, borda=True):
        c = ws[ref]
        c.value = valor
        c.font = font
        c.alignment = align
        if fmt:
            c.number_format = fmt
        if fill:
            c.fill = fill
        if borda:
            c.border = BORDA
        return c

    def mesclar(ws, rng, valor=None, borda=True, **kw):
        ws.merge_cells(rng)
        celula(ws, rng.split(":")[0], valor, borda=borda, **kw)
        if borda:
            for row in ws[rng]:
                for c in row:
                    c.border = BORDA

    grupos: dict[tuple, list[PagamentoAula]] = {}
    for p in pagamentos:
        grupos.setdefault((p.aula.professor_id, p.contrato_id), []).append(p)

    nomes_usados: set[str] = set()
    ordenados = sorted(
        grupos.values(),
        key=lambda itens: itens[0].aula.professor.nome if itens[0].aula.professor else "",
    )
    for itens in ordenados:
        itens.sort(key=lambda p: (p.aula.data, p.aula.horario_inicio))
        prof = itens[0].aula.professor
        contrato = itens[0].contrato
        prof_nome = (prof.nome if prof else "—").upper()

        # Nome de aba único (máx. 31 chars, sem caracteres inválidos)
        bruto = f"{prof_nome[:22]} {contrato.numero_contrato if contrato else ''}"
        base = "".join(ch for ch in bruto if ch not in "[]:*?/\\").strip()[:31] or "BM"
        nome_aba, n = base, 2
        while nome_aba in nomes_usados:
            nome_aba = f"{base[:27]} ({n})"
            n += 1
        nomes_usados.add(nome_aba)

        ws = wb.create_sheet(nome_aba)
        ws.sheet_view.showGridLines = False
        for i, w in enumerate(LARGURAS, 1):
            ws.column_dimensions[get_column_letter(i)].width = w

        infos = [info_evento.get(p.aula.evento_id, {}) for p in itens]
        coordenador = next((i["coordenador"] for i in infos if i.get("coordenador")), None)
        modalidade = next((i["modalidade"] for i in infos if i.get("modalidade")), "")
        eventos_aulas = [p.aula.evento for p in itens if p.aula.evento]
        if contrato:
            valor_hora = float(contrato.valor_hora)
        else:
            h0 = float(itens[0].horas)
            valor_hora = round(float(itens[0].valor) / h0, 2) if h0 else 0.0
        valor_contrato = (
            round(float(contrato.valor_hora) * float(contrato.total_horas_previstas), 2) if contrato else None
        )
        total_medicao = round(sum(float(p.valor) for p in itens), 2)
        data_ini_contrato = min((e.data_inicio for e in eventos_aulas), default=None)
        data_fim_contrato = max((e.data_fim for e in eventos_aulas), default=None)

        def fmt_d(d):
            return d.strftime("%d/%m/%Y") if d else ""

        # ── Cabeçalho ──
        mesclar(ws, "B1:K1", "BOLETIM DE MEDIÇÃO", font=FB, fill=AZUL)
        cab = [
            ("DOCENTE:", prof_nome, "VALOR DO CONTRATO:", valor_contrato,
             "DATA INICIAL:", fmt_d(data_ini_contrato)),
            ("CONTRATO:", contrato.numero_contrato if contrato else "", "VALOR DA MEDIÇÃO:", total_medicao,
             "DATA FINAL:", fmt_d(data_fim_contrato)),
            ("SOLICITAÇÃO DE COMPRA:", "", "MODALIDADE:", (modalidade or "").upper(),
             "SITUAÇÃO:", "EM ANDAMENTO" if (contrato is None or contrato.ativo) else "ENCERRADO"),
            ("VALOR HORA AULA:", valor_hora, "TIPO DE CONTRATO:", (prof.tipo if prof else "").upper(),
             "NUMERO DO BM:", ""),
        ]
        for i, (l1, v1, l2, v2, l3, v3) in enumerate(cab):
            r = 2 + i
            celula(ws, f"B{r}", l1, font=FB, align=ESQ)
            mesclar(ws, f"C{r}:D{r}", v1, fmt=MOEDA if isinstance(v1, float) else None)
            mesclar(ws, f"E{r}:F{r}", l2, font=FB, align=ESQ)
            celula(ws, f"G{r}", v2, fmt=MOEDA if isinstance(v2, float) else None)
            celula(ws, f"H{r}", l3, font=FB, align=ESQ)
            celula(ws, f"I{r}", v3)

        # ── Período de medição ──
        mesclar(ws, "B7:K7", "PERÍODO DE MEDIÇÃO", font=FB)
        celula(ws, "B8", "DATA INICIAL:", font=FB, align=ESQ)
        mesclar(ws, "C8:K8", fmt_d(itens[0].aula.data), align=ESQ)
        celula(ws, "B9", "DATA FINAL:", font=FB, align=ESQ)
        mesclar(ws, "C9:K9", fmt_d(itens[-1].aula.data), align=ESQ)

        # ── Tabela de aulas ──
        HDR = 11
        titulos = ["DATA", "EVENTO", "CURSO", "CARGA HORARIA", "TURNO", "AULA / UC",
                   "AMBIENTE", "R$ UNIT.", "R$ TOTAL", "STATUS PAGAMENTO"]
        for j, t in enumerate(titulos, 2):
            celula(ws, f"{get_column_letter(j)}{HDR}", t, font=FB, align=ESQ if j in (2, 10, 11) else CENTRO)

        for k, (p, info) in enumerate(zip(itens, infos), 1):
            r = HDR + k
            aula = p.aula
            uc = (aula.unidade_curricular.nome if aula.unidade_curricular else aula.uc_nome_original) or "—"
            ambiente = aula.ambiente or aula.sala or info.get("sala") or ""
            horas = float(p.horas)
            unit = round(float(p.valor) / horas, 2) if horas else valor_hora
            celula(ws, f"A{r}", k, align=DIR, borda=False)
            celula(ws, f"B{r}", fmt_d(aula.data), align=DIR)
            celula(ws, f"C{r}", info.get("codigo") or "")
            celula(ws, f"D{r}", (info.get("curso") or "").upper())
            celula(ws, f"E{r}", _hhmm(horas))
            celula(ws, f"F{r}", _turno(aula, info.get("turno")))
            celula(ws, f"G{r}", uc.upper())
            celula(ws, f"H{r}", ambiente.upper())
            celula(ws, f"I{r}", unit, align=DIR, fmt=MOEDA)
            celula(ws, f"J{r}", float(p.valor), align=DIR, fmt=MOEDA)
            celula(ws, f"K{r}", {"pago": "PAGO", "encaminhado": "ENCAMINHADO"}.get(p.status, p.status.upper()), align=ESQ)

        ult = HDR + len(itens)
        tot = ult + 1
        celula(ws, f"I{tot}", "TOTAL:", font=FB, align=ESQ)
        celula(ws, f"J{tot}", f"=SUM(J{HDR + 1}:J{ult})", font=FB, align=DIR, fmt=MOEDA)

        # ── Assinaturas ──
        s = tot + 3
        mesclar(ws, f"B{s}:G{s}", "RESPONSÁVEL PELA APROVAÇÃO", borda=False)
        for col in "BCDEFG":
            ws[f"{col}{s}"].border = Border(top=medium)

        a = s + 3
        nome_coord = (coordenador or "").strip()
        ws.row_dimensions[a].height = 32
        # Assinatura "manuscrita" (fonte cursiva) do coordenador do evento
        assinatura = " ".join(
            w.lower() if w.lower() in ("da", "de", "do", "das", "dos", "e") else w.capitalize()
            for w in nome_coord.split()
        )
        mesclar(ws, f"B{a}:D{a}", assinatura or None, borda=False,
                font=Font(name="Segoe Script", size=16, color="404040"),
                align=Alignment(horizontal="center", vertical="bottom"))
        mesclar(ws, f"B{a + 1}:D{a + 1}", nome_coord.upper() or "COORDENADOR(A)", borda=False)
        mesclar(ws, f"B{a + 2}:D{a + 2}", "COORDENADOR(A)", borda=False)
        mesclar(ws, f"H{a + 1}:K{a + 1}", prof_nome, borda=False)
        mesclar(ws, f"H{a + 2}:K{a + 2}", "DOCENTE", borda=False)
        for col in "BCDHIJK":
            ws[f"{col}{a + 1}"].border = Border(top=medium)

        # Impressão: paisagem, ajustado à largura da página
        ws.page_setup.orientation = "landscape"
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.print_area = f"A1:K{a + 2}"

    if not wb.sheetnames:
        ws = wb.create_sheet("Boletim")
        ws["A1"] = "Nenhum pagamento encontrado para os filtros selecionados."

    return wb
