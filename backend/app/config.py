from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    PROJECT_NAME: str = "Sistema de Planejamento Acadêmico"
    API_V1_STR: str = "/api/v1"

    # Database — aceita formato Railway/Render ("postgres://...") e converte automaticamente
    DATABASE_URL: str = "postgresql+asyncpg://academico:academico_pass@localhost:5432/academico_db"

    @property
    def async_database_url(self) -> str:
        url = self.DATABASE_URL
        # Railway e Render entregam "postgres://" ou "postgresql://" — precisa do driver asyncpg
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    SECRET_KEY: str = "change-me-in-production-at-least-32-chars-long"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    # Anthropic
    ANTHROPIC_API_KEY: str = ""

    # Admin inicial (seed automático na primeira inicialização)
    ADMIN_EMAIL: str = ""
    ADMIN_SENHA: str = ""

    # Uploads
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 50


settings = Settings()
