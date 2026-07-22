"""
Endpoints administrativos — limpeza de dados do banco.
Sem controle de permissão por ora (será adicionado com sistema de usuários).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, delete

from app.database import get_db
from app.core.deps import require_admin

router = APIRouter(prefix="/admin", tags=["Administração"])

# Mapa: tipo → lista de tabelas a limpar (na ordem correta para FK)
_TABELAS: dict[str, list[str]] = {
    "aulas": [
        "aulas",
    ],
    "planejamento": [
        "aulas",
        "eventos",
    ],
    "ofertas": [
        "ofertas_cursos",
    ],
    "importacao": [
        "aulas",
        "disponibilidade_detalhada",
        "atuacoes",
        "unidades_curriculares",
        "professores",
        "cursos",
    ],
    "tudo": [
        "aulas",
        "eventos",
        "ofertas_cursos",
        "disponibilidade_detalhada",
        "atuacoes",
        "unidades_curriculares",
        "professores",
        "cursos",
    ],
}

_DESCRICOES: dict[str, str] = {
    "aulas":        "Todas as aulas (cronograma)",
    "planejamento": "Aulas + Eventos de planejamento",
    "ofertas":      "Todas as ofertas SENAI importadas",
    "importacao":   "Cursos, professores, UCs, atuações e disponibilidades",
    "tudo":         "Todo o banco de dados (exceto usuário admin)",
}


@router.get("/limpar/opcoes")
async def listar_opcoes(_=Depends(require_admin)):
    """Lista os tipos de limpeza disponíveis."""
    return [
        {"tipo": k, "descricao": v, "tabelas": _TABELAS[k]}
        for k, v in _DESCRICOES.items()
    ]


@router.delete("/limpar/{tipo}")
async def limpar_dados(
    tipo: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Apaga registros das tabelas correspondentes ao tipo.
    Tipos válidos: aulas | planejamento | ofertas | importacao | tudo
    """
    if tipo not in _TABELAS:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Tipo inválido. Use: {', '.join(_TABELAS.keys())}"
        )

    tabelas = _TABELAS[tipo]
    contagens: dict[str, int] = {}

    for tabela in tabelas:
        result = await db.execute(text(f"SELECT COUNT(*) FROM {tabela}"))
        total = result.scalar() or 0
        await db.execute(text(f"DELETE FROM {tabela}"))
        contagens[tabela] = total

    await db.commit()

    total_removido = sum(contagens.values())
    return {
        "ok": True,
        "tipo": tipo,
        "descricao": _DESCRICOES[tipo],
        "registros_removidos": contagens,
        "total": total_removido,
    }
