"""
Fixtures compartilhadas para os testes.

Estratégia de isolamento:
- Banco SQLite em memória único, engine compartilhado na session
- Cada teste usa um AsyncSession ligado a uma CONNECTION com transação aberta
- O get_db override retorna a MESMA sessão, mas commit() dentro do endpoint
  vira um NO-OP porque a sessão usa join_transaction_mode="create_savepoint"
- Ao final do teste, o connection.rollback() desfaz tudo (incluindo savepoints)
"""
import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.main import app as fastapi_app
from app.database import get_db, Base
import app.models  # noqa: F401 – garante que todos os modelos são registrados no Base
from app.core.security import create_access_token, hash_password

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    """
    Sessão de DB por teste, com rollback total ao final.
    Usa join_transaction_mode="create_savepoint" para que commits do endpoint
    criem SAVEPOINT em vez de commitar a transação externa.
    """
    async with test_engine.connect() as connection:
        await connection.begin()
        session = AsyncSession(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        yield session
        await session.close()
        await connection.rollback()


@pytest_asyncio.fixture
async def client(db_session):
    """AsyncClient com get_db substituído pela sessão de teste."""
    async def _override_get_db():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_user(db_session):
    """Cria usuário admin no banco de teste e retorna o objeto."""
    from app.models.usuario import Usuario

    email = f"admin_{uuid.uuid4().hex[:8]}@teste.com"
    admin = Usuario(
        nome="Admin Teste",
        email=email,
        hashed_password=hash_password("Senha@123"),
        perfil="admin",
        ativo=True,
    )
    db_session.add(admin)
    await db_session.flush()
    return admin


@pytest_asyncio.fixture
async def admin_token(admin_user) -> str:
    """Retorna JWT do usuário admin criado para o teste."""
    return create_access_token({"sub": str(admin_user.id), "perfil": "admin"})


@pytest_asyncio.fixture
async def auth_client(client, admin_token):
    """Cliente já autenticado como admin."""
    client.headers["Authorization"] = f"Bearer {admin_token}"
    return client


@pytest_asyncio.fixture
async def professor_mensalista(db_session):
    """Professor mensalista com 40h/semana para testes de regência."""
    from app.models.professor import Professor

    prof = Professor(
        nome="Prof Teste Mensalista",
        tipo="Mensalista",
        horas_contratadas=40,
        ativo=True,
    )
    db_session.add(prof)
    await db_session.flush()
    return prof


@pytest_asyncio.fixture
async def professor_horista(db_session):
    """Professor horista para testes de regência."""
    from app.models.professor import Professor

    prof = Professor(
        nome="Prof Teste Horista",
        tipo="Horista",
        horas_contratadas=20,
        valor_hora=50.0,
        ativo=True,
    )
    db_session.add(prof)
    await db_session.flush()
    return prof
