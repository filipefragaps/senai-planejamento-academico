from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Atuacao(Base):
    __tablename__ = "atuacoes"
    __table_args__ = (UniqueConstraint("professor_id", "disciplina", "curso_id", name="uq_atuacao"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    professor_id: Mapped[int] = mapped_column(ForeignKey("professores.id", ondelete="CASCADE"), nullable=False)
    curso_id: Mapped[int | None] = mapped_column(ForeignKey("cursos.id", ondelete="SET NULL"))
    disciplina: Mapped[str] = mapped_column(String(300), nullable=False)
    modalidade: Mapped[str | None] = mapped_column(String(50), nullable=True)
    nivel_competencia: Mapped[int] = mapped_column(Integer, default=3)  # 1-5
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    professor: Mapped["Professor"] = relationship("Professor", back_populates="atuacoes")
    curso: Mapped["Curso | None"] = relationship("Curso", back_populates="atuacoes")
