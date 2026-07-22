from datetime import datetime, time
from sqlalchemy import String, Integer, ForeignKey, DateTime, Time, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class DisponibilidadeDetalhada(Base):
    __tablename__ = "disponibilidade_detalhada"
    __table_args__ = (
        UniqueConstraint("professor_id", "dia_semana", "horario_inicio", "horario_fim", name="uq_disponibilidade"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    professor_id: Mapped[int] = mapped_column(ForeignKey("professores.id", ondelete="CASCADE"), nullable=False, index=True)
    dia_semana: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Segunda...6=Domingo
    horario_inicio: Mapped[time] = mapped_column(Time, nullable=False)
    horario_fim: Mapped[time] = mapped_column(Time, nullable=False)
    tipo_disponibilidade: Mapped[str] = mapped_column(String(30), default="Disponível")  # Disponível | Indisponível | Preferencial
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    professor: Mapped["Professor"] = relationship("Professor", back_populates="disponibilidades")
