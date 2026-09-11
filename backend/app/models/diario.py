from datetime import datetime, date, time
from sqlalchemy import String, Integer, ForeignKey, DateTime, Date, Time, Float, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class DiarioAula(Base):
    """Registro importado do diário de execução (planilha de aulas ministradas)."""
    __tablename__ = "diario_aulas"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Dados brutos da planilha
    instrutor: Mapped[str] = mapped_column(String(300), index=True)
    evento_codigo: Mapped[str | None] = mapped_column(String(50), index=True)   # ex: "1069274"
    evento_nome: Mapped[str | None] = mapped_column(String(500))                # ex: "COSTUREIRO INDUSTRIAL - MALHA"
    componente_codigo: Mapped[str | None] = mapped_column(String(50))           # ex: "275614"
    componente_nome: Mapped[str | None] = mapped_column(String(500))
    data: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    hora_inicio: Mapped[time | None] = mapped_column(Time)
    hora_termino: Mapped[time | None] = mapped_column(Time)
    qtde_horas: Mapped[float | None] = mapped_column(Float)
    ambiente: Mapped[str | None] = mapped_column(String(200))
    conteudo: Mapped[str | None] = mapped_column(Text)

    # Vínculos resolvidos no import
    professor_id: Mapped[int | None] = mapped_column(ForeignKey("professores.id", ondelete="SET NULL"), index=True)
    aula_id: Mapped[int | None] = mapped_column(ForeignKey("aulas.id", ondelete="SET NULL"), index=True)

    importado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    professor: Mapped["Professor | None"] = relationship("Professor")
