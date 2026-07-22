from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings
from app.api.v1.router import api_router


async def _aplicar_migracoes(engine) -> None:
    """Aplica ALTER TABLE incrementais compatível com PostgreSQL e SQLite."""
    from sqlalchemy import text

    is_postgres = "postgresql" in str(engine.url)

    def _col_stmt(stmt: str) -> str:
        # PostgreSQL suporta ADD COLUMN IF NOT EXISTS — evita abortar a transação
        if is_postgres:
            return stmt.replace("ADD COLUMN ", "ADD COLUMN IF NOT EXISTS ", 1)
        return stmt

    alter_stmts = [
        "ALTER TABLE atuacoes ADD COLUMN modalidade VARCHAR(50)",
        "ALTER TABLE ofertas_cursos ADD COLUMN previsao_inicio VARCHAR(100)",
        "ALTER TABLE ofertas_cursos ADD COLUMN execucao VARCHAR(100)",
        "ALTER TABLE ofertas_cursos ADD COLUMN status_cronograma VARCHAR(100)",
        "ALTER TABLE aulas ADD COLUMN unidade_curricular_id INTEGER REFERENCES unidades_curriculares(id) ON DELETE SET NULL",
        "ALTER TABLE aulas ADD COLUMN numero_aula INTEGER",
        "ALTER TABLE aulas ADD COLUMN subturma VARCHAR(20)",
        "ALTER TABLE aulas ADD COLUMN etapa VARCHAR(50)",
        "ALTER TABLE aulas ADD COLUMN turno VARCHAR(20)",
        "ALTER TABLE aulas ADD COLUMN tipo_contrato VARCHAR(20)",
        "ALTER TABLE aulas ADD COLUMN ambiente VARCHAR(100)",
        "ALTER TABLE eventos ADD COLUMN oferta_id INTEGER REFERENCES ofertas_cursos(id) ON DELETE SET NULL",
        "ALTER TABLE eventos ADD COLUMN professores_preferidos JSON",
        "ALTER TABLE eventos ADD COLUMN modulo_etapa_inicial VARCHAR(50)",
        "ALTER TABLE calendario_academico ADD COLUMN letivo BOOLEAN NOT NULL DEFAULT 1",
    ]

    # Cada ALTER TABLE em transação própria — PostgreSQL aborta toda a transação
    # se um comando falha; assim apenas o comando problemático é revertido.
    for stmt in alter_stmts:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(_col_stmt(stmt)))
        except Exception:
            pass

    # Retrocompatibilidade: dados padrão
    for stmt in [
        "UPDATE atuacoes SET modalidade = 'Habilitação Técnica' WHERE modalidade IS NULL OR modalidade = ''",
        (
            "UPDATE calendario_academico SET letivo = 0 "
            "WHERE LOWER(tipo) IN ('feriado','recesso','ferias','férias','folga',"
            "'compensacao','compensação','sem aula') AND letivo = 1"
        ),
    ]:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception:
            pass


async def _seed_admin(engine) -> None:
    """Cria o usuário admin inicial se não existir (via env vars ADMIN_EMAIL e ADMIN_SENHA)."""
    admin_email = getattr(settings, "ADMIN_EMAIL", None)
    admin_senha = getattr(settings, "ADMIN_SENHA", None)
    if not admin_email or not admin_senha:
        return
    from sqlalchemy import text
    from app.core.security import hash_password
    async with engine.begin() as conn:
        row = await conn.execute(text("SELECT id FROM usuarios WHERE email = :e"), {"e": admin_email})
        if row.fetchone():
            return
        await conn.execute(
            text("INSERT INTO usuarios (nome, email, hashed_password, perfil, ativo) VALUES (:n, :e, :h, 'admin', 1)"),
            {"n": "Administrador", "e": admin_email, "h": hash_password(admin_senha)},
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.database import create_tables, engine
    await create_tables()
    await _aplicar_migracoes(engine)
    await _seed_admin(engine)
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Sistema Inteligente de Planejamento Acadêmico com IA — SENAI",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/", include_in_schema=False)
async def root():
    return JSONResponse({"sistema": settings.PROJECT_NAME, "versao": "1.0.0", "docs": "/docs"})


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}
