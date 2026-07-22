from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

_db_url = settings.async_database_url
_is_sqlite = _db_url.startswith("sqlite")

_engine_kwargs = dict(echo=settings.APP_ENV == "development")
if not _is_sqlite:
    _engine_kwargs.update(pool_pre_ping=True, pool_size=10, max_overflow=20)
else:
    # SQLite: single connection, no pool size limits
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_async_engine(_db_url, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
