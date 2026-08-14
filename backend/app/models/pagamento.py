from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class PagamentoAula(Base):
    __tablename__ = "pagamentos_aula"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    aula_id: Mapped[int] = mapped_column(
        ForeignKey("aulas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contrato_id: Mapped[int] = mapped_column(
        ForeignKey("contratos_docente.id"), nullable=False, index=True
    )
    # encaminhado | pago | revertido
    status: Mapped[str] = mapped_column(String(20), default="encaminhado")
    encaminhado_por_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), nullable=False)
    encaminhado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    confirmado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    confirmado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    horas: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    valor: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    aula: Mapped["Aula"] = relationship("Aula")
    contrato: Mapped["ContratoDocente"] = relationship("ContratoDocente", back_populates="pagamentos")
    encaminhado_por: Mapped["Usuario"] = relationship("Usuario", foreign_keys=[encaminhado_por_id])
    confirmado_por: Mapped["Usuario | None"] = relationship("Usuario", foreign_keys=[confirmado_por_id])
    historico: Mapped[list["HistoricoPagamento"]] = relationship(
        "HistoricoPagamento", back_populates="pagamento", cascade="all, delete-orphan"
    )


class HistoricoPagamento(Base):
    __tablename__ = "historico_pagamentos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    pagamento_id: Mapped[int] = mapped_column(
        ForeignKey("pagamentos_aula.id", ondelete="CASCADE"), nullable=False, index=True
    )
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), nullable=False)
    acao: Mapped[str] = mapped_column(String(30))  # encaminhado | confirmado | revertido
    horas: Mapped[float] = mapped_column(Numeric(6, 2))
    valor: Mapped[float] = mapped_column(Numeric(10, 2))
    observacao: Mapped[str | None] = mapped_column(String(500), nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pagamento: Mapped["PagamentoAula"] = relationship("PagamentoAula", back_populates="historico")
    usuario: Mapped["Usuario"] = relationship("Usuario")
