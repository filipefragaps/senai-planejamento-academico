"""
Importador do cronograma SEDUC (cursos integrados com Ensino Médio).

Diferença em relação ao importador padrão:
  - Colunas HORA_INICIO e HORA_TERMINO separadas (D e E)
  - Não depende de uma coluna "Horário" combinada

Colunas esperadas:
  Data | Evento | Turno | HORA_INICIO | HORA_TERMINO | Curso | Unidade Curricular |
  Aula | Subturma | Professor | Ambiente | Carga Horária | Etapa | Modalidade | Área

Todas as aulas importadas recebem fonte='seduc' — permite rollback total via
DELETE /importacao/cronograma-seduc.
"""
import io
from datetime import date, time

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete

from app.models.aula import Aula
from app.services.excel_import_cronograma import (
    _norm_col, _get, _parse_date, _parse_time,
    _turno, _lookup_professor, _lookup_ou_criar_evento,
    _lookup_curso, _lookup_uc, _norm_status,
)

FONTE = "seduc"


async def importar_cronograma_seduc(
    conteudo: bytes,
    db: AsyncSession,
) -> dict:
    """Lê a planilha SEDUC e faz upsert de aulas marcadas com fonte='seduc'."""
    xls = pd.ExcelFile(io.BytesIO(conteudo))

    # Aceita a primeira aba, ou qualquer uma cujo nome contenha "seduc"/"cronograma"
    aba = xls.sheet_names[0]
    for nome in xls.sheet_names:
        n = nome.lower()
        if "seduc" in n or "cronograma" in n:
            aba = nome
            break

    df = pd.read_excel(xls, sheet_name=aba, dtype=str)
    df.columns = [_norm_col(c) for c in df.columns]

    criadas = 0
    atualizadas = 0
    erros: list[str] = []

    cache_curso: dict[str, int | None] = {}
    cache_evento: dict[str, object] = {}
    cache_prof: dict[str, int | None] = {}

    for idx, row in df.iterrows():
        try:
            data_aula = _parse_date(row.get("data", ""))
            if not data_aula:
                continue

            nome_turma = _get(row, "evento", "turma", "nome_turma")
            if not nome_turma:
                continue

            # Horários explícitos HORA_INICIO / HORA_TERMINO
            h_ini = _parse_time(row.get("hora_inicio", "") or row.get("hora_in_cio", ""))
            h_fim = _parse_time(row.get("hora_termino", "") or row.get("hora_ter_mino", ""))

            # Fallback: se não tiver horário, usa turno
            if not h_ini:
                turno_raw = _get(row, "turno")
                from app.services.excel_import_cronograma import _horarios_do_turno
                ht = _horarios_do_turno(turno_raw) if turno_raw else None
                if ht:
                    h_ini, h_fim = ht
                else:
                    h_ini = time(8, 0)
                    h_fim = time(12, 0)
            if not h_fim:
                h_fim = h_ini

            turno_raw = _get(row, "turno") or _turno(h_ini)

            nome_curso = _get(row, "curso")
            if nome_curso not in cache_curso:
                cache_curso[nome_curso] = await _lookup_curso(nome_curso, db)
            curso_id = cache_curso[nome_curso]

            disciplina = nome_curso or _get(row, "unidade_curricular", "unidade_c", "uc") or nome_turma

            if nome_turma not in cache_evento:
                cache_evento[nome_turma] = await _lookup_ou_criar_evento(nome_turma, disciplina, curso_id, db)
            evento = cache_evento[nome_turma]

            nome_prof = _get(row, "professor")
            if nome_prof not in cache_prof:
                cache_prof[nome_prof] = await _lookup_professor(nome_prof, db)
            professor_id = cache_prof[nome_prof]

            uc_nome = _get(row, "unidade_curricular", "unidade_c", "uc")
            uc_id = await _lookup_uc(uc_nome, curso_id, db)

            etapa = _get(row, "etapa", "modulo")
            ambiente = _get(row, "ambiente", "sala")
            subturma = _get(row, "subturma")
            status = _norm_status(_get(row, "status", "situacao") or "Agendada")

            num_aula_raw = _get(row, "aula", "numero_aula")
            try:
                numero_aula = int(float(num_aula_raw)) if num_aula_raw else None
            except (ValueError, TypeError):
                numero_aula = None

            # Upsert: busca por evento + data + horario_inicio
            res_ex = await db.execute(
                select(Aula).where(
                    and_(
                        Aula.evento_id == evento.id,
                        Aula.data == data_aula,
                        Aula.horario_inicio == h_ini,
                    )
                )
            )
            existente = res_ex.scalar_one_or_none()

            if existente:
                existente.professor_id = professor_id
                # Preserva vínculo existente se o novo lookup falhou
                existente.unidade_curricular_id = uc_id or existente.unidade_curricular_id
                existente.uc_nome_original = uc_nome or existente.uc_nome_original
                existente.horario_fim = h_fim
                existente.etapa = etapa or existente.etapa
                existente.turno = turno_raw or existente.turno
                existente.ambiente = ambiente or existente.ambiente
                existente.subturma = subturma or existente.subturma
                existente.status = status
                existente.numero_aula = numero_aula or existente.numero_aula
                existente.alterada_manualmente = True
                existente.fonte = FONTE
                atualizadas += 1
            else:
                aula = Aula(
                    evento_id=evento.id,
                    professor_id=professor_id,
                    unidade_curricular_id=uc_id,
                    uc_nome_original=uc_nome or None,
                    data=data_aula,
                    horario_inicio=h_ini,
                    horario_fim=h_fim,
                    etapa=etapa or None,
                    turno=turno_raw or None,
                    ambiente=ambiente or None,
                    subturma=subturma or None,
                    numero_aula=numero_aula,
                    status=status,
                    alterada_manualmente=True,
                    fonte=FONTE,
                )
                db.add(aula)
                criadas += 1

        except Exception as e:
            erros.append(f"Linha {idx + 2}: {e}")

    await db.flush()
    return {
        "criadas": criadas,
        "atualizadas": atualizadas,
        "erros": erros[:20],
    }


async def reverter_importacao_seduc(db: AsyncSession) -> dict:
    """Remove todas as aulas marcadas com fonte='seduc'."""
    result = await db.execute(
        select(Aula).where(Aula.fonte == FONTE)
    )
    aulas = result.scalars().all()
    count = len(aulas)
    for a in aulas:
        await db.delete(a)
    await db.flush()
    return {"deletadas": count}
