from datetime import datetime
from sqlalchemy import Integer, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class GrupoAula(Base):
    __tablename__ = "grupo_aula"

    id: Mapped[int] = mapped_column(primary_key=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    aulas: Mapped[list["Aula"]] = relationship("Aula", back_populates="grupo")
