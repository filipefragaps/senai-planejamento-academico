from datetime import date, datetime
from sqlalchemy import Integer, Float, Date, String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class PontoMensal(Base):
    __tablename__ = "ponto_mensal"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome_colaborador: Mapped[str] = mapped_column(String(300))
    data_inicio: Mapped[date] = mapped_column(Date, index=True)
    data_fim: Mapped[date] = mapped_column(Date, index=True)
    horas_efetivas: Mapped[float | None] = mapped_column(Float, nullable=True)
    horas_extras: Mapped[float | None] = mapped_column(Float, nullable=True)
    horas_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    professor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("professores.id", ondelete="SET NULL"), nullable=True, index=True
    )
    importado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    professor: Mapped["Professor | None"] = relationship("Professor")
