from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, Numeric, Boolean, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ContratoDocente(Base):
    __tablename__ = "contratos_docente"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    professor_id: Mapped[int] = mapped_column(
        ForeignKey("professores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    numero_contrato: Mapped[str] = mapped_column(String(100), nullable=False)
    valor_hora: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    total_horas_previstas: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    descricao: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Lista de eventos vinculados: [{id, nome_turma, nome_curso}]
    eventos: Mapped[list | None] = mapped_column(JSON, nullable=True)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    professor: Mapped["Professor"] = relationship("Professor", back_populates="contratos")
    pagamentos: Mapped[list["PagamentoAula"]] = relationship("PagamentoAula", back_populates="contrato")
