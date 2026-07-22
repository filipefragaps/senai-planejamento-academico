import io
import pandas as pd
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.excel_import import excel_import_service, _norm_col
from app.core.deps import get_current_user
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
