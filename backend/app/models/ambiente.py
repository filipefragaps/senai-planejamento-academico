from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Ambiente(Base):
    __tablename__ = "ambientes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bloco: Mapped[str | None] = mapped_column(String(100))
    nome: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    sigla: Mapped[str | None] = mapped_column(String(50), index=True)
    capacidade: Mapped[int | None] = mapped_column(Integer)
    tipo: Mapped[str] = mapped_column(String(50), nullable=False)   # "Sala Teórica" | "Laboratório" | "Híbrido"
    tags: Mapped[list | None] = mapped_column(JSON)                  # ["Automação", "Elétrica", ...]
    observacoes: Mapped[str | None] = mapped_column(Text)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
