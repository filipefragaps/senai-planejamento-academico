from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Curso(Base):
    __tablename__ = "cursos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome: Mapped[str] = mapped_column(String(300), nullable=False)
    codigo: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    carga_horaria_total: Mapped[int] = mapped_column(Integer, nullable=False)
    modalidade: Mapped[str] = mapped_column(String(50), default="Presencial")  # Presencial | EAD | Híbrido
    area: Mapped[str | None] = mapped_column(String(200))
    descricao: Mapped[str | None] = mapped_column(Text)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    eventos: Mapped[list["Evento"]] = relationship("Evento", back_populates="curso")
    atuacoes: Mapped[list["Atuacao"]] = relationship("Atuacao", back_populates="curso")
    unidades_curriculares: Mapped[list["UnidadeCurricular"]] = relationship(
        "UnidadeCurricular", back_populates="curso", cascade="all, delete-orphan"
    )
