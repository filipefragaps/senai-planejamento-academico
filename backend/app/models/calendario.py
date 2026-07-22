from datetime import datetime, date
from sqlalchemy import String, Date, DateTime, Boolean, Text, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class CalendarioAcademico(Base):
    __tablename__ = "calendario_academico"
    __table_args__ = (UniqueConstraint("data", "tipo", name="uq_calendario"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    data: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(50), nullable=False)  # Feriado | Recesso | Folga | Evento | Avaliação
    letivo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # False = sem aula neste dia
    descricao: Mapped[str | None] = mapped_column(Text)
    periodo: Mapped[str | None] = mapped_column(String(50))  # 2024/1, 2024/2, etc
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
