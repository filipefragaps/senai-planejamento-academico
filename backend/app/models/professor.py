from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Professor(Base):
    __tablename__ = "professores"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    cpf: Mapped[str | None] = mapped_column(String(14), unique=True)
    email: Mapped[str | None] = mapped_column(String(200))
    telefone: Mapped[str | None] = mapped_column(String(20))
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)  # Mensalista | Horista
    horas_contratadas: Mapped[float] = mapped_column(Float, nullable=False)  # horas/semana para mensalistas
    valor_hora: Mapped[float | None] = mapped_column(Float)  # para horistas
    especialidades: Mapped[str | None] = mapped_column(Text)  # JSON list or comma-separated
    titulacao: Mapped[str | None] = mapped_column(String(100))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    atuacoes: Mapped[list["Atuacao"]] = relationship("Atuacao", back_populates="professor")
    disponibilidades: Mapped[list["DisponibilidadeDetalhada"]] = relationship("DisponibilidadeDetalhada", back_populates="professor")
    eventos: Mapped[list["Evento"]] = relationship("Evento", back_populates="professor")
    aulas: Mapped[list["Aula"]] = relationship("Aula", back_populates="professor")
