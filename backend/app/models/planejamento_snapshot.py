from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, DateTime, JSON, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PlanejamentoSnapshot(Base):
    """Snapshot do planejamento anterior, salvo antes de cada confirmação.

    Permite reverter ao estado imediatamente anterior caso o coordenador
    se arrependa do planejamento confirmado. Mantém apenas os 2 últimos
    snapshots por evento para não acumular dados.
    """
    __tablename__ = "planejamento_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    evento_id: Mapped[int] = mapped_column(
        ForeignKey("eventos.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # JSON array com todos os campos relevantes de cada Aula deletada/substituída
    aulas_snapshot: Mapped[list] = mapped_column(JSON, nullable=False)
    # Quantas aulas estavam no snapshot
    total_aulas: Mapped[int] = mapped_column(Integer, default=0)
    descricao: Mapped[str | None] = mapped_column(String(300))
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
