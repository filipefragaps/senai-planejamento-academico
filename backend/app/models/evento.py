from datetime import datetime, date, time
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Date, Time, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Evento(Base):
    """Turma/grupo de aulas com cronograma definido."""
    __tablename__ = "eventos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome_turma: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    curso_id: Mapped[int | None] = mapped_column(ForeignKey("cursos.id", ondelete="SET NULL"))
    disciplina: Mapped[str] = mapped_column(String(300), nullable=False)
    carga_horaria_total: Mapped[float] = mapped_column(Float, nullable=False)
    horas_semanais: Mapped[float] = mapped_column(Float, nullable=False)
    data_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    data_fim: Mapped[date] = mapped_column(Date, nullable=False)
    dias_semana: Mapped[list] = mapped_column(JSON, nullable=False)  # [0,2,4] = seg,qua,sex
    horario_inicio: Mapped[time] = mapped_column(Time, nullable=False)
    horario_fim: Mapped[time] = mapped_column(Time, nullable=False)
    professor_id: Mapped[int | None] = mapped_column(ForeignKey("professores.id", ondelete="SET NULL"))
    sala: Mapped[str | None] = mapped_column(String(100))
    modalidade: Mapped[str] = mapped_column(String(50), default="Presencial")
    status: Mapped[str] = mapped_column(String(30), default="Planejado")  # Planejado | Ativo | Concluído | Cancelado
    observacoes: Mapped[str | None] = mapped_column(Text)
    oferta_id: Mapped[int | None] = mapped_column(ForeignKey("ofertas_cursos.id", ondelete="SET NULL"))
    professores_preferidos: Mapped[list | None] = mapped_column(JSON)   # [professor_id, ...]
    modulo_etapa_inicial: Mapped[str | None] = mapped_column(String(50))  # ex: "BÁSICO"
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    curso: Mapped["Curso | None"] = relationship("Curso", back_populates="eventos")
    professor: Mapped["Professor | None"] = relationship("Professor", back_populates="eventos")
    aulas: Mapped[list["Aula"]] = relationship("Aula", back_populates="evento", cascade="all, delete-orphan")
