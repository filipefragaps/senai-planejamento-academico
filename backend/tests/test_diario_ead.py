"""Diário EaD: importação separada do presencial, vínculo pelo evento + turno (manhã/tarde)."""
import io
from datetime import date, time

import pandas as pd
from sqlalchemy import func, select

from app.models.aula import Aula
from app.models.diario import DiarioAula
from app.models.evento import Evento
from app.services.excel_import_diario import importar_diario

COLUNAS = ["INSTRUTOR", "EVENTO - CURSO", "COMPONENTE", "DIA", "HORA INÍCIO", "HORA TÉRMINO", "QTDE. HORAS",
           "AMBIENTE", "CONTEÚDO MINISTRADO"]
SABADO = date(2026, 8, 8)


def _planilha(linhas):
    buf = io.BytesIO()
    pd.DataFrame(linhas, columns=COLUNAS).to_excel(buf, index=False)
    return buf.getvalue()


async def test_diario_ead_importa_sem_apagar_presencial_e_vincula_por_turno(auth_client, db_session, professor_horista):
    nome = professor_horista.nome
    ev = Evento(nome_turma="1099001", disciplina="TÉCNICO EM LOGÍSTICA EAD", carga_horaria_total=80, horas_semanais=8,
                data_inicio=date(2026, 8, 1), data_fim=date(2026, 12, 1), dias_semana=[5],
                horario_inicio=time(8), horario_fim=time(17))
    outro = Evento(nome_turma="1099002", disciplina="OUTRO CURSO EAD", carga_horaria_total=80, horas_semanais=8,
                   data_inicio=date(2026, 8, 1), data_fim=date(2026, 12, 1), dias_semana=[5],
                   horario_inicio=time(8), horario_fim=time(17))
    db_session.add_all([ev, outro])
    await db_session.flush()
    manha = Aula(evento_id=ev.id, professor_id=professor_horista.id, data=SABADO, horario_inicio=time(8),
                 horario_fim=time(12), uc_nome_original="Gestão de Estoques")
    tarde = Aula(evento_id=ev.id, professor_id=professor_horista.id, data=SABADO, horario_inicio=time(13),
                 horario_fim=time(17), uc_nome_original="Gestão de Estoques")
    db_session.add_all([manha, tarde])
    # Diário presencial já importado (não pode ser apagado pelo EaD)
    db_session.add(DiarioAula(instrutor=nome, professor_id=professor_horista.id, data=date(2026, 8, 5),
                              hora_inicio=time(19), hora_termino=time(22), qtde_horas=3, evento_codigo="555"))
    await db_session.flush()

    conteudo = _planilha([
        # Horários diferentes do planejado e UC com erro de digitação: vale o evento + turno
        [nome, "1099001 - TÉCNICO EM LOGÍSTICA EAD", "Gestao de Estoque", "08/08/2026", "09:00", "13:00", "4", "EAD", "Aula 1"],
        [nome, "1099001 - TÉCNICO EM LOGÍSTICA EAD", "Gestao de Estoque", "08/08/2026", "14:00", "18:00", "4", "EAD", "Aula 2"],
    ])
    res = await importar_diario(conteudo, db_session, "ead")
    await db_session.flush()
    assert res == {"inseridos": 2, "erros": 0}

    regs = (await db_session.execute(select(DiarioAula).order_by(DiarioAula.data, DiarioAula.hora_inicio))).scalars().all()
    assert [(r.origem, r.aula_id) for r in regs] == [("presencial", None), ("ead", manha.id), ("ead", tarde.id)]
    assert regs[1].componente_codigo is None and regs[1].componente_nome == "Gestao de Estoque"
    assert regs[1].evento_codigo == "1099001"

    params = {"data_inicio": "2026-08-01", "data_fim": "2026-08-31"}
    comp = (await auth_client.get(f"/api/v1/diario/comparacao/{professor_horista.id}", params=params)).json()
    sab = [p for p in comp["planejadas"] if p["data"] == "2026-08-08"]
    assert [(p["horario_inicio"], p["diario"]["hora_inicio"], p["diario"]["origem"]) for p in sab] == [
        ("08:00", "09:00", "ead"), ("13:00", "14:00", "ead")]
    assert all(p["diario"]["evento_codigo"] == p["evento_codigo"] for p in sab)
    assert comp["horas_executadas"] == 3 + 4 + 4

    info = (await auth_client.get("/api/v1/diario/info")).json()
    assert info["total"] == 3 and info["ead"]["total"] == 2

    # Evento diferente no diário: ainda vincula pelo turno, e a tela mostra "Evento divergente"
    conteudo = _planilha([
        [nome, "1099002 - OUTRO CURSO EAD", "Gestão de Estoques", "08/08/2026", "08:00", "12:00", "4", "EAD", ""],
    ])
    await importar_diario(conteudo, db_session, "ead")
    await db_session.flush()
    regs = (await db_session.execute(select(DiarioAula.origem, DiarioAula.aula_id, DiarioAula.evento_codigo))).all()
    assert sorted(regs, key=lambda r: r.origem) == [("ead", manha.id, "1099002"), ("presencial", None, "555")]
    comp = (await auth_client.get(f"/api/v1/diario/comparacao/{professor_horista.id}", params=params)).json()
    sab = {p["horario_inicio"]: p for p in comp["planejadas"] if p["data"] == "2026-08-08"}
    assert sab["08:00"]["diario"]["evento_codigo"] == "1099002" != sab["08:00"]["evento_codigo"]
    assert sab["13:00"]["diario"] is None

    # Importar o presencial de novo mantém o EaD
    await importar_diario(_planilha([[nome, "555 - CURSO", "1 - UC", "05/08/2026", "19:00", "22:00", "3", "", ""]]),
                          db_session)
    await db_session.flush()
    por_origem = dict((await db_session.execute(
        select(DiarioAula.origem, func.count()).group_by(DiarioAula.origem))).all())
    assert por_origem == {"presencial": 1, "ead": 1}
