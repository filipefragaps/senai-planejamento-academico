import io
import pandas as pd
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.excel_import import excel_import_service, _norm_col
from app.services.excel_import_seduc import importar_cronograma_seduc, reverter_importacao_seduc
from app.core.deps import get_current_user, require_admin
from app.config import settings

router = APIRouter(prefix="/importacao", tags=["Importação"])


@router.post("/excel")
async def importar_excel(
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Importa planilha Excel com as abas:
    CURSOS, PROFESSORES, ATUAÇÃO, DISPONIBILIDADE DETALHADA, CALENDÁRIO ACADÊMICO
    """
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    tamanho_max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    conteudo = await arquivo.read()
    if len(conteudo) > tamanho_max:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máximo {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        resultado = await excel_import_service.importar(conteudo, db)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar planilha: {str(e)}")

    return {
        "sucesso": True,
        "importados": resultado,
        "abas_encontradas": resultado.get("abas_encontradas", []),
        "mensagem": (
            f"Importação concluída: {resultado['cursos']} cursos, "
            f"{resultado['professores']} professores, "
            f"{resultado['atuacoes']} atuações, "
            f"{resultado['disponibilidades']} disponibilidades, "
            f"{resultado['calendario']} eventos no calendário."
        ),
    }


@router.post("/diagnostico")
async def diagnosticar_excel(
    arquivo: UploadFile = File(...),
    _=Depends(get_current_user),
):
    """Lê a planilha e retorna abas + colunas detectadas (sem importar nada)."""
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")
    conteudo = await arquivo.read()
    try:
        xls = pd.ExcelFile(io.BytesIO(conteudo))
        resultado = {}
        for sheet in xls.sheet_names:
            try:
                df = pd.read_excel(xls, sheet_name=sheet, nrows=3, dtype=str)
                colunas_orig = list(df.columns)
                colunas_norm = [_norm_col(c) for c in colunas_orig]
                resultado[sheet] = {
                    "colunas_originais": colunas_orig,
                    "colunas_normalizadas": colunas_norm,
                    "linhas_amostra": df.head(2).fillna("").to_dict(orient="records"),
                }
            except Exception as e:
                resultado[sheet] = {"erro": str(e)}
        return {"abas": list(xls.sheet_names), "detalhe": resultado}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao ler planilha: {str(e)}")


@router.post("/cronograma-seduc")
async def importar_seduc(
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Importa planilha SEDUC (cursos integrados com Ensino Médio).
    Colunas: Data | Evento | Turno | HORA_INICIO | HORA_TERMINO | Curso |
             Unidade Curricular | Aula | Subturma | Professor | Ambiente | ...
    Todas as aulas são marcadas com fonte='seduc' para rollback.
    """
    if not arquivo.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    tamanho_max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    conteudo = await arquivo.read()
    if len(conteudo) > tamanho_max:
        raise HTTPException(status_code=400, detail=f"Arquivo muito grande (máximo {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        resultado = await importar_cronograma_seduc(conteudo, db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=422, detail=f"Erro ao processar planilha SEDUC: {str(e)}")

    return {
        "sucesso": True,
        "criadas": resultado["criadas"],
        "atualizadas": resultado["atualizadas"],
        "erros": resultado["erros"],
        "mensagem": (
            f"Importação SEDUC concluída: {resultado['criadas']} aulas criadas, "
            f"{resultado['atualizadas']} atualizadas."
            + (f" {len(resultado['erros'])} erros." if resultado["erros"] else "")
        ),
    }


@router.delete("/cronograma-seduc")
async def reverter_seduc(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """Remove todas as aulas importadas via planilha SEDUC (fonte='seduc')."""
    try:
        resultado = await reverter_importacao_seduc(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao reverter importação SEDUC: {str(e)}")

    return {
        "sucesso": True,
        "deletadas": resultado["deletadas"],
        "mensagem": f"Rollback concluído: {resultado['deletadas']} aulas SEDUC removidas.",
    }


@router.post("/relink-professores")
async def relink_professores(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Retroativamente vincula professores em aulas onde professor_id é null.
    Usa o nome do evento para localizar o professor via lookup melhorado.
    Necessário após atualização do _lookup_professor com normalização de acentos.
    """
    from sqlalchemy import select, update, and_
    from app.models.aula import Aula
    from app.models.evento import Evento
    from app.models.professor import Professor
    from app.services.excel_import_cronograma import _lookup_professor

    # Busca todos os professores uma vez para matching em memória
    all_profs_res = await db.execute(select(Professor))
    all_profs = all_profs_res.scalars().all()

    # Aulas sem professor vinculado (qualquer fonte)
    res = await db.execute(
        select(Aula.id, Aula.uc_nome_original, Evento.nome_turma, Evento.professor_id.label("evt_prof_id"))
        .join(Evento, Aula.evento_id == Evento.id)
        .where(
            and_(
                Aula.professor_id.is_(None),
                Aula.fonte.is_not(None),  # apenas aulas importadas
            )
        )
    )
    rows = res.fetchall()

    vinculadas = 0
    for r in rows:
        # Tenta usar professor_id do evento como fallback direto
        if r.evt_prof_id:
            await db.execute(
                update(Aula).where(Aula.id == r.id).values(professor_id=r.evt_prof_id)
            )
            vinculadas += 1
            continue

    await db.commit()
    return {
        "processadas": len(rows),
        "vinculadas": vinculadas,
        "mensagem": (
            f"{vinculadas} aulas vinculadas via evento.professor_id. "
            "Para vincular pelo nome (aulas sem evento.professor_id), reimporte a planilha."
        ),
    }


@router.get("/template")
async def baixar_template(_=Depends(get_current_user)):
    """Retorna link para download do template Excel."""
    return {
        "abas": [
            {
                "nome": "CURSOS",
                "colunas": ["codigo", "nome", "carga_horaria_total", "modalidade", "area"],
            },
            {
                "nome": "PROFESSORES",
                "colunas": ["nome", "cpf", "email", "telefone", "tipo", "horas_contratadas", "valor_hora", "especialidades", "titulacao"],
            },
            {
                "nome": "ATUAÇÃO",
                "colunas": ["professor", "disciplina", "curso", "nivel_competencia"],
            },
            {
                "nome": "DISPONIBILIDADE DETALHADA",
                "colunas": ["professor", "dia_semana", "horario_inicio", "horario_fim", "tipo_disponibilidade"],
                "exemplo_dia": "segunda, terça, quarta, quinta, sexta, sábado, domingo",
                "exemplo_tipo": "Disponível, Indisponível, Preferencial",
            },
            {
                "nome": "CALENDÁRIO ACADÊMICO",
                "colunas": ["data", "tipo", "descricao", "periodo"],
                "exemplo_tipo": "Aula, Feriado, Recesso, Evento, Avaliação",
            },
        ]
    }
