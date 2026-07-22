from datetime import datetime, date, time
from sqlalchemy import String, Integer, ForeignKey, DateTime, Date, Time, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Aula(Base):
    """Aula individual gerada a partir de um Evento."""
    __tablename__ = "aulas"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    evento_id: Mapped[int] = mapped_column(ForeignKey("eventos.id", ondelete="CASCADE"), nullable=False, index=True)
    professor_id: Mapped[int | None] = mapped_column(ForeignKey("professores.id", ondelete="SET NULL"), index=True)
    unidade_curricular_id: Mapped[int | None] = mapped_column(ForeignKey("unidades_curriculares.id", ondelete="SET NULL"), index=True)
    data: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    horario_inicio: Mapped[time] = mapped_column(Time, nullable=False)
    horario_fim: Mapped[time] = mapped_column(Time, nullable=False)
    sala: Mapped[str | None] = mapped_column(String(100))
    ambiente: Mapped[str | None] = mapped_column(String(100))   # nome completo do ambiente/laboratório
    numero_aula: Mapped[int | None] = mapped_column(Integer)    # sequência dentro do evento
    subturma: Mapped[str | None] = mapped_column(String(20))    # subgrupo: A, B, C...
    etapa: Mapped[str | None] = mapped_column(String(50))       # módulo/etapa (denorm da UC)
    turno: Mapped[str | None] = mapped_column(String(20))       # Manhã | Tarde | Noite
    tipo_contrato: Mapped[str | None] = mapped_column(String(20))  # Mensalista | Horista (denorm)
    status: Mapped[str] = mapped_column(String(30), default="Agendada")  # Agendada | Realizada | Cancelada | Substituída | Remarcada
    tipo: Mapped[str] = mapped_column(String(30), default="Regular")  # Regular | Reposição | Avaliação | Evento
    observacoes: Mapped[str | None] = mapped_column(Text)
    alterada_manualmente: Mapped[bool] = mapped_column(default=False)
    dados_anteriores: Mapped[dict | None] = mapped_column(JSON)  # snapshot before manual change
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    evento: Mapped["Evento"] = relationship("Evento", back_populates="aulas")
    professor: Mapped["Professor | None"] = relationship("Professor", back_populates="aulas")
    unidade_curricular: Mapped["UnidadeCurricular | None"] = relationship("UnidadeCurricular")
