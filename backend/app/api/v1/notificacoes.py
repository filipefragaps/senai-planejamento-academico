"""
Envio de e-mail para docentes com diários de execução em aberto.
Usa SMTP do Outlook corporativo (Office 365) com App Password.
"""
import smtplib
from datetime import date
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, not_, exists
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.deps import get_current_user, require_admin_ou_coordenador
from app.database import get_db
from app.models.aula import Aula
from app.models.diario import DiarioAula
from app.models.evento import Evento
from app.models.professor import Professor
from app.models.unidade_curricular import UnidadeCurricular

router = APIRouter(prefix="/notificacoes", tags=["Notificações"])


class NotificarRequest(BaseModel):
    data_inicio: date
    data_fim: date
    ccs: list[str] = []
    professor_ids: list[int] | None = None  # se preenchido, envia apenas para estes IDs


def _email_html(professor_nome: str, aulas: list[dict], periodo: str) -> str:
    rows = "".join(
        f"""<tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px 12px;">{a['data']}</td>
            <td style="padding:8px 12px;">{a['horario_inicio']}–{a['horario_fim']}</td>
            <td style="padding:8px 12px;">{a['evento_nome']}</td>
            <td style="padding:8px 12px;">{a['uc_nome']}</td>
        </tr>"""
        for a in aulas
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <div style="background:#003B8E;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:18px;">SENAI — Diário de Aulas em Aberto</h1>
      <p style="margin:4px 0 0;color:#c8d8f0;font-size:13px;">Período: {periodo}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin-top:0;">Prezado(a) <strong>{professor_nome}</strong>,</p>
      <p>Identificamos que as seguintes aulas ainda <strong>não possuem diário de execução preenchido</strong>:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;">
        <thead>
          <tr style="background:#f0f4ff;text-transform:uppercase;font-size:11px;color:#555;">
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #dbe4ff;">Data</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #dbe4ff;">Horário</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #dbe4ff;">Evento / Turma</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #dbe4ff;">UC / Disciplina</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p>Por favor, providencie o preenchimento do diário o mais breve possível.</p>
      <p style="margin-bottom:0;">Atenciosamente,<br><strong>Equipe de Coordenação — SENAI</strong></p>
    </div>
    <div style="background:#f9f9f9;padding:14px 32px;border-top:1px solid #eee;font-size:11px;color:#999;">
      Mensagem automática do Sistema de Planejamento Acadêmico. Não responda a este e-mail.
    </div>
  </div>
</body></html>"""


@router.get("/config")
async def config_email(_=Depends(get_current_user)):
    """Retorna se o e-mail está configurado (não expõe credenciais)."""
    return {
        "configurado": bool(settings.SMTP_USER and settings.SMTP_PASSWORD),
        "remetente": settings.SMTP_USER or None,
    }


@router.post("/diarios-abertos")
async def notificar_diarios_abertos(
    body: NotificarRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_ou_coordenador),
):
    """Envia e-mail para cada docente com diários em aberto no período informado."""
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        raise HTTPException(400, "E-mail não configurado. Defina SMTP_USER e SMTP_PASSWORD no ambiente.")

    # Aulas sem diário no período
    q = (
        select(Aula)
        .join(Professor, Aula.professor_id == Professor.id)
        .join(Evento, Aula.evento_id == Evento.id)
        .options(
            selectinload(Aula.professor),
            selectinload(Aula.evento),
            selectinload(Aula.unidade_curricular),
        )
        .where(Aula.status.notin_(["Cancelada", "Remarcada"]))
        .where(Aula.data >= body.data_inicio)
        .where(Aula.data <= body.data_fim)
        .where(not_(exists().where(DiarioAula.aula_id == Aula.id)))
        .order_by(Aula.professor_id, Aula.data, Aula.horario_inicio)
    )
    if body.professor_ids is not None:
        q = q.where(Aula.professor_id.in_(body.professor_ids))
    result = await db.execute(q)
    aulas = result.scalars().all()

    if not aulas:
        return {"enviados": 0, "sem_email": 0, "erros": 0,
                "detalhes_enviados": [], "detalhes_sem_email": [], "detalhes_erros": []}

    # UC names
    uc_ids = {a.unidade_curricular_id for a in aulas if a.unidade_curricular_id}
    uc_nome_map: dict[int, str] = {}
    if uc_ids:
        res_uc = await db.execute(
            select(UnidadeCurricular.id, UnidadeCurricular.nome).where(UnidadeCurricular.id.in_(uc_ids))
        )
        uc_nome_map = {r.id: r.nome for r in res_uc.all()}

    # Agrupar por professor
    por_prof: dict[int, dict] = {}
    for a in aulas:
        pid = a.professor_id
        if pid not in por_prof:
            por_prof[pid] = {
                "nome": a.professor.nome if a.professor else "—",
                "email": (a.professor.email or "").strip() if a.professor else "",
                "aulas": [],
            }
        por_prof[pid]["aulas"].append({
            "data": a.data.strftime("%d/%m/%Y"),
            "horario_inicio": a.horario_inicio.strftime("%H:%M"),
            "horario_fim": a.horario_fim.strftime("%H:%M"),
            "evento_nome": a.evento.nome_turma if a.evento else "—",
            "uc_nome": a.uc_nome_original or uc_nome_map.get(a.unidade_curricular_id or 0) or "—",
        })

    periodo = f"{body.data_inicio.strftime('%d/%m/%Y')} a {body.data_fim.strftime('%d/%m/%Y')}"
    enviados: list[dict] = []
    sem_email: list[str] = []
    erros: list[dict] = []

    # Conecta SMTP uma única vez para todos os envios
    try:
        smtp = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)
        smtp.ehlo()
        smtp.starttls()
        smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
    except Exception as e:
        raise HTTPException(503, f"Falha ao conectar ao servidor de e-mail: {e}")

    try:
        ccs_validos = [c.strip() for c in body.ccs if c.strip()]
        for dados in por_prof.values():
            if not dados["email"]:
                sem_email.append(dados["nome"])
                continue

            html = _email_html(dados["nome"], dados["aulas"], periodo)
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"[SENAI] Diário de aulas em aberto — {periodo}"
            msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
            msg["To"] = dados["email"]
            if ccs_validos:
                msg["Cc"] = ", ".join(ccs_validos)
            msg.attach(MIMEText(html, "html", "utf-8"))

            destinatarios = [dados["email"]] + ccs_validos
            try:
                smtp.sendmail(settings.SMTP_USER, destinatarios, msg.as_string())
                enviados.append({
                    "nome": dados["nome"],
                    "email": dados["email"],
                    "aulas": len(dados["aulas"]),
                })
            except Exception as e:
                erros.append({"nome": dados["nome"], "email": dados["email"], "erro": str(e)})
    finally:
        try:
            smtp.quit()
        except Exception:
            pass

    return {
        "enviados": len(enviados),
        "sem_email": len(sem_email),
        "erros": len(erros),
        "detalhes_enviados": enviados,
        "detalhes_sem_email": sem_email,
        "detalhes_erros": erros,
    }


@router.post("/diarios-abertos/preview")
async def preview_notificacao(
    body: NotificarRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Retorna a lista de docentes e contagem de aulas que seriam notificados, sem enviar e-mails."""
    q = (
        select(Aula)
        .join(Professor, Aula.professor_id == Professor.id)
        .options(selectinload(Aula.professor))
        .where(Aula.status.notin_(["Cancelada", "Remarcada"]))
        .where(Aula.data >= body.data_inicio)
        .where(Aula.data <= body.data_fim)
        .where(not_(exists().where(DiarioAula.aula_id == Aula.id)))
        .order_by(Aula.professor_id)
    )
    result = await db.execute(q)
    aulas = result.scalars().all()

    profs: dict[int, dict] = {}
    for a in aulas:
        pid = a.professor_id
        if pid not in profs:
            email = (a.professor.email or "").strip() if a.professor else ""
            profs[pid] = {
                "id": pid,
                "nome": a.professor.nome if a.professor else "—",
                "email": email,
                "tem_email": bool(email),
                "total_aulas": 0,
            }
        profs[pid]["total_aulas"] += 1

    lista = sorted(profs.values(), key=lambda p: p["nome"])
    return {
        "total_aulas": len(aulas),
        "total_docentes": len(profs),
        "professores": lista,
    }
