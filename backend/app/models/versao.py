from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, DateTime, JSON, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class VersaoCronograma(Base):
    """Histórico de versões do cronograma para comparação antes/depois."""
    __tablename__ = "versoes_cronograma"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    evento_id: Mapped[int | None] = mapped_column(ForeignKey("eventos.id", ondelete="SET NULL"), index=True)
    aula_id: Mapped[int | None] = mapped_column(ForeignKey("aulas.id", ondelete="SET NULL"), index=True)
    tipo_alteracao: Mapped[str] = mapped_column(String(50), nullable=False)  # criacao | edicao | cancelamento | replanejamento
    dados_antes: Mapped[dict | None] = mapped_column(JSON)
    dados_depois: Mapped[dict | None] = mapped_column(JSON)
    motivo: Mapped[str | None] = mapped_column(Text)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
