from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class UnidadeCurricular(Base):
    __tablename__ = "unidades_curriculares"
    __table_args__ = (
        UniqueConstraint("curso_id", "codigo_uc", name="uq_uc_curso"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    curso_id: Mapped[int] = mapped_column(ForeignKey("cursos.id", ondelete="CASCADE"), nullable=False, index=True)
    codigo_uc: Mapped[str] = mapped_column(String(20), nullable=False)   # cod UC (ex: 24784)
    nome: Mapped[str] = mapped_column(String(500), nullable=False)        # UNIDADE CURRICULAR
    tipo: Mapped[str] = mapped_column(String(20), default="Presencial")   # PRESENCIAL | EAD
    modulo_etapa: Mapped[str | None] = mapped_column(String(50))          # BÁSICO | ESPECÍFICO I | II | III
    sequencia: Mapped[int | None] = mapped_column(Integer)                # UC (nº dentro do módulo)
    carga_horaria: Mapped[int] = mapped_column(Integer, default=0)        # horas da UC

    curso: Mapped["Curso"] = relationship("Curso", back_populates="unidades_curriculares")
