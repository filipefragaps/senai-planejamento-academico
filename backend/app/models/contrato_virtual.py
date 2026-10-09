from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ContratoVirtual(Base):
    __tablename__ = "contratos_virtuais"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    professor_id: Mapped[int] = mapped_column(
        ForeignKey("professores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nome_completo: Mapped[str] = mapped_column(String(300), nullable=False)
    cpf: Mapped[str | None] = mapped_column(String(20), nullable=True)
    conta_corrente: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    telefone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    evento_id: Mapped[int | None] = mapped_column(
        ForeignKey("eventos.id", ondelete="SET NULL"), nullable=True
    )
    evento_nome: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # [{uc_id, uc_nome}]
    ucs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    modalidade: Mapped[str] = mapped_column(String(100), nullable=False)
    justificativa: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pendente")  # pendente | aprovado | rejeitado
    aprovado_por: Mapped[str | None] = mapped_column(String(200), nullable=True)
    aprovado_por_id: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True
    )
    aprovado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
