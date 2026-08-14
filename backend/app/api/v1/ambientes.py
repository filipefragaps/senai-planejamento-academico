"""
Router de Ambientes (Salas e Laboratórios).
CRUD completo + import Excel + template Excel.
"""
import io
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, or_

from app.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.ambiente import Ambiente

router = APIRouter(prefix="/ambientes", tags=["Ambientes"])

TIPOS_VALIDOS = {"Sala Teórica", "Laboratório", "Híbrido"}


# ── Schemas ────────────────────────────────────────────────────────────────────

class AmbienteCreate(BaseModel):
    bloco: Optional[str] = None
    nome: str
    sigla: Optional[str] = None
    capacidade: Optional[int] = None
    tipo: str = "Sala Teórica"
    tags: Optional[list[str]] = None
    observacoes: Optional[str] = None
    ativo: bool = True


class AmbienteUpdate(BaseModel):
    bloco: Optional[str] = None
    nome: Optional[str] = None
    sigla: Optional[str] = None
    capacidade: Optional[int] = None
    tipo: Optional[str] = None
    tags: Optional[list[str]] = None
    observacoes: Optional[str] = None
    ativo: Optional[bool] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().strip().lower()


def _upper(s: str | None) -> str | None:
    return s.strip().upper() if s and s.strip() else None


def _serializar(a: Ambiente) -> dict:
    return {
        "id": a.id,
        "bloco": a.bloco,
        "nome": a.nome,
        "sigla": a.sigla,
        "capacidade": a.capacidade,
        "tipo": a.tipo,
        "tags": a.tags or [],
        "observacoes": a.observacoes,
        "ativo": a.ativo,
        "criado_em": a.criado_em.isoformat() if a.criado_em else None,
        "atualizado_em": a.atualizado_em.isoformat() if a.atualizado_em else None,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/")
async def listar(
    busca: Optional[str] = None,
    bloco: Optional[str] = None,
    tipo: Optional[str] = None,
    tag: Optional[str] = None,
    ativo: Optional[bool] = None,
    skip: int = 0,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Lista ambientes com filtros opcionais."""
    q = select(Ambiente)
    filters = []
    if busca:
        t = f"%{busca}%"
        filters.append(or_(Ambiente.nome.ilike(t), Ambiente.bloco.ilike(t)))
    if bloco:
        filters.append(Ambiente.bloco.ilike(f"%{bloco}%"))
    if tipo:
        filters.append(Ambiente.tipo == tipo)
    if ativo is not None:
        filters.append(Ambiente.ativo == ativo)
    if filters:
        q = q.where(and_(*filters))
    q = q.order_by(Ambiente.bloco.nullslast(), Ambiente.nome).offset(skip).limit(limit)
    result = await db.execute(q)
    ambientes = result.scalars().all()

    # Filtro de tag (JSON array — não suportado nativamente em WHERE pelo ORM)
    if tag:
        tag_norm = _norm(tag)
        ambientes = [
            a for a in ambientes
            if any(_norm(t) == tag_norm for t in (a.tags or []))
        ]

    return [_serializar(a) for a in ambientes]


@router.post("/", status_code=201)
async def criar(
    body: AmbienteCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    if body.tipo not in TIPOS_VALIDOS:
        raise HTTPException(status_code=422, detail=f"Tipo inválido. Use: {', '.join(TIPOS_VALIDOS)}")
    data = body.model_dump()
    data["bloco"] = _upper(data.get("bloco"))
    data["nome"] = (data.get("nome") or "").strip().upper()
    data["sigla"] = _upper(data.get("sigla"))
    amb = Ambiente(**data)
    db.add(amb)
    await db.commit()
    await db.refresh(amb)
    return _serializar(amb)


@router.get("/{amb_id}")
async def obter(
    amb_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Ambiente).where(Ambiente.id == amb_id))
    amb = result.scalar_one_or_none()
    if not amb:
        raise HTTPException(status_code=404, detail="Ambiente não encontrado")
    return _serializar(amb)


@router.put("/{amb_id}")
async def atualizar(
    amb_id: int,
    body: AmbienteUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(Ambiente).where(Ambiente.id == amb_id))
    amb = result.scalar_one_or_none()
    if not amb:
        raise HTTPException(status_code=404, detail="Ambiente não encontrado")
    if body.tipo and body.tipo not in TIPOS_VALIDOS:
        raise HTTPException(status_code=422, detail=f"Tipo inválido. Use: {', '.join(TIPOS_VALIDOS)}")
    updates = body.model_dump(exclude_unset=True)
    if "bloco" in updates:
        updates["bloco"] = _upper(updates["bloco"])
    if "nome" in updates:
        updates["nome"] = (updates["nome"] or "").strip().upper()
    if "sigla" in updates:
        updates["sigla"] = _upper(updates["sigla"])
    for campo, valor in updates.items():
        setattr(amb, campo, valor)
    await db.commit()
    await db.refresh(amb)
    return _serializar(amb)


@router.delete("/{amb_id}", status_code=200)
async def deletar(
    amb_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(Ambiente).where(Ambiente.id == amb_id))
    amb = result.scalar_one_or_none()
    if not amb:
        raise HTTPException(status_code=404, detail="Ambiente não encontrado")
    await db.delete(amb)
    await db.commit()
    return {"removido": amb_id}


@router.delete("/", status_code=200)
async def deletar_todos(
    bloco: Optional[str] = Query(default=None),
    tipo: Optional[str] = Query(default=None),
    confirmar: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """Remove todos (ou por bloco/tipo). Requer confirmar=true."""
    if not confirmar:
        raise HTTPException(status_code=422, detail="Passe confirmar=true para confirmar a exclusão em lote.")
    q = select(Ambiente)
    filters = []
    if bloco:
        filters.append(Ambiente.bloco.ilike(f"%{bloco}%"))
    if tipo:
        filters.append(Ambiente.tipo == tipo)
    if filters:
        q = q.where(and_(*filters))
    result = await db.execute(q)
    ambientes = result.scalars().all()
    for a in ambientes:
        await db.delete(a)
    await db.commit()
    return {"removidos": len(ambientes)}


# ── Template Excel ─────────────────────────────────────────────────────────────

@router.get("/template/download")
async def template_excel(_=Depends(get_current_user)):
    """Retorna planilha modelo para importação de ambientes."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl não instalado no servidor.")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "AMBIENTES"

    headers = ["Bloco", "Sala / Nome", "Sigla", "Capacidade", "Tipo", "Tags", "Observações"]
    examples = [
        ["BLOCO A", "LAB. AUTOMAÇÃO 01", "BLA-AUTO01", 30, "Laboratório", "Automação, Elétrica", "Equipamentos para CLP"],
        ["BLOCO A", "SALA TEÓRICA 101", "BLA-101", 40, "Sala Teórica", "Elétrica", ""],
        ["BLOCO B", "LAB. INFORMÁTICA 02", "BLB-INFO02", 25, "Laboratório", "Informática", "20 computadores Dell"],
        ["BLOCO B", "SALA HÍBRIDA 201", "BLB-201", 35, "Híbrido", "Automação, Informática", "Quadro interativo"],
        ["PRINCIPAL", "AUDITÓRIO", "AUD", 120, "Sala Teórica", "", "Uso para eventos"],
    ]
    notes = [
        ["INSTRUÇÕES:"],
        ["• Bloco: número/nome do bloco (ex: BLOCO A, 1, PRINCIPAL). Opcional. Será gravado em maiúsculo."],
        ["• Sala / Nome: nome da sala. Obrigatório. Será gravado em maiúsculo."],
        ["• Sigla: código curto da sala (ex: BLA-101, AUD). Opcional. Será gravado em maiúsculo."],
        ["• Capacidade: número inteiro de vagas. Opcional."],
        ["• Tipo: Sala Teórica | Laboratório | Híbrido"],
        ["• Tags: separar por vírgula (ex: Automação, Elétrica, Informática, Mecânica)"],
        ["• Observações: texto livre. Opcional."],
    ]

    header_fill = PatternFill("solid", fgColor="003B8E")
    header_font = Font(color="FFFFFF", bold=True, size=11)
    note_fill = PatternFill("solid", fgColor="FFF3CD")
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # Headers
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border

    # Examples
    alt_fill = PatternFill("solid", fgColor="F0F4FF")
    for row_idx, row_data in enumerate(examples, 2):
        for col_idx, val in enumerate(row_data, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            if row_idx % 2 == 0:
                cell.fill = alt_fill
            cell.border = border
            cell.alignment = Alignment(vertical="center")

    # Notes sheet
    ws2 = wb.create_sheet("INSTRUÇÕES")
    for row_idx, row_data in enumerate(notes, 1):
        cell = ws2.cell(row=row_idx, column=1, value=row_data[0])
        cell.fill = note_fill if row_idx == 1 else PatternFill()
        cell.font = Font(bold=(row_idx == 1))

    # Column widths
    col_widths = [18, 30, 16, 14, 18, 35, 40]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 20
    ws2.column_dimensions["A"].width = 70

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=modelo_ambientes.xlsx"},
    )


# ── Import Excel ───────────────────────────────────────────────────────────────

def _get_cell(row, headers: list[str], *names: str) -> str | None:
    for name in names:
        for i, h in enumerate(headers):
            if _norm(h) == _norm(name) and i < len(row):
                val = row[i]
                return str(val).strip() if val is not None and str(val).strip() else None
    return None


@router.post("/importar", status_code=201)
async def importar(
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Importa ambientes de planilha Excel. Colunas: Bloco, Sala / Nome, Capacidade, Tipo, Tags, Observações."""
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    conteudo = await arquivo.read()
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(conteudo), data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao ler planilha: {e}")

    if not rows:
        raise HTTPException(status_code=422, detail="Planilha vazia.")

    headers = [str(c or "").strip() for c in rows[0]]
    inseridos = 0
    atualizados = 0
    ignorados = 0
    erros: list[str] = []

    for row_num, row in enumerate(rows[1:], 2):
        row = list(row)
        nome_raw = _get_cell(row, headers, "sala / nome", "sala", "nome", "ambiente")
        if not nome_raw:
            ignorados += 1
            continue

        nome = nome_raw.strip().upper()
        bloco_raw = _get_cell(row, headers, "bloco", "bloco / número")
        bloco = bloco_raw.strip().upper() if bloco_raw else None
        sigla_raw = _get_cell(row, headers, "sigla", "codigo", "código", "cod")
        sigla = sigla_raw.strip().upper() if sigla_raw else None
        cap_raw = _get_cell(row, headers, "capacidade", "cap")
        tipo_raw = _get_cell(row, headers, "tipo") or "Sala Teórica"
        tags_raw = _get_cell(row, headers, "tags", "tag", "área", "area")
        obs = _get_cell(row, headers, "observações", "observacoes", "obs")

        # Normaliza capacidade
        capacidade: int | None = None
        if cap_raw:
            try:
                capacidade = int(float(cap_raw))
            except (ValueError, TypeError):
                pass

        # Normaliza tipo
        tipo_map = {
            "sala teorica": "Sala Teórica", "sala teórica": "Sala Teórica", "teorica": "Sala Teórica",
            "laboratorio": "Laboratório", "laboratório": "Laboratório", "lab": "Laboratório",
            "hibrido": "Híbrido", "híbrido": "Híbrido", "hibrida": "Híbrido", "híbrida": "Híbrido",
        }
        tipo = tipo_map.get(_norm(tipo_raw), "Sala Teórica")

        # Normaliza tags
        tags: list[str] = []
        if tags_raw:
            tags = [t.strip() for t in tags_raw.split(",") if t.strip()]

        try:
            # Upsert por bloco+nome
            q = select(Ambiente).where(Ambiente.nome == nome)
            if bloco:
                q = q.where(Ambiente.bloco == bloco)
            result = await db.execute(q)
            existente = result.scalars().first()

            if existente:
                existente.capacidade = capacidade if capacidade is not None else existente.capacidade
                existente.tipo = tipo
                existente.tags = tags or existente.tags
                existente.observacoes = obs if obs else existente.observacoes
                if sigla:
                    existente.sigla = sigla
                atualizados += 1
            else:
                db.add(Ambiente(
                    bloco=bloco, nome=nome, sigla=sigla, capacidade=capacidade,
                    tipo=tipo, tags=tags, observacoes=obs, ativo=True,
                ))
                inseridos += 1
        except Exception as e:
            erros.append(f"Linha {row_num}: {e}")

    await db.commit()
    return {
        "inseridos": inseridos,
        "atualizados": atualizados,
        "ignorados": ignorados,
        "erros": erros,
    }
