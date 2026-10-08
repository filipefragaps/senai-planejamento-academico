from datetime import datetime
from sqlalchemy import String, Integer, Boolean, Text, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class GpColaborador(Base):
    """Base de colaboradores importada do Excel."""
    __tablename__ = "gp_colaboradores"

    matricula: Mapped[str] = mapped_column(String(50), primary_key=True)
    nome: Mapped[str] = mapped_column(String(300))
    email: Mapped[str] = mapped_column(String(300), default="")
    supervisor: Mapped[str] = mapped_column(String(300), default="")
    supervisor_email: Mapped[str] = mapped_column(String(300), default="")
    area: Mapped[str] = mapped_column(String(300), default="")
    weekly_hours: Mapped[str | None] = mapped_column(String(10), nullable=True)
    schedule: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unidade: Mapped[str] = mapped_column(String(300), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GpRegistroDiario(Base):
    """Registro de ponto diário por colaborador (DailyRecord do parser TypeScript)."""
    __tablename__ = "gp_registros_diarios"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    matricula: Mapped[str] = mapped_column(String(50), index=True)
    collaborator: Mapped[str] = mapped_column(String(300))
    date_key: Mapped[str] = mapped_column(String(8))   # YYYYMMDD
    date_display: Mapped[str] = mapped_column(String(10))  # DD/MM/YYYY
    area: Mapped[str] = mapped_column(String(300), default="")
    supervisor: Mapped[str] = mapped_column(String(300), default="")
    supervisor_email: Mapped[str] = mapped_column(String(300), default="")
    weekly_hours: Mapped[str | None] = mapped_column(String(10), nullable=True)
    schedule: Mapped[str | None] = mapped_column(String(100), nullable=True)
    schedule_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    expected_minutes: Mapped[int] = mapped_column(Integer, default=0)
    worked_minutes: Mapped[int] = mapped_column(Integer, default=0)
    punches: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    non_working_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("matricula", "date_key", name="uq_gp_diario_matricula_data"),
    )


class GpOcorrencia(Base):
    """Ocorrência de ponto (ajuste identificado). Status é preservado entre importações."""
    __tablename__ = "gp_ocorrencias"

    # ID vindo do parser: "{normalize(collaborator)}-{dateKey}-{category}"
    occurrence_id: Mapped[str] = mapped_column(String(300), primary_key=True)
    matricula: Mapped[str] = mapped_column(String(50), index=True)
    collaborator: Mapped[str] = mapped_column(String(300))
    date_display: Mapped[str] = mapped_column(String(10))
    date_key: Mapped[str] = mapped_column(String(8), index=True)
    category: Mapped[str] = mapped_column(String(100))
    severity: Mapped[str] = mapped_column(String(20), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    punches: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    schedule: Mapped[str] = mapped_column(String(100), default="")
    scale_suggestion: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    # Status nunca é sobrescrito pelo import se já foi alterado pelo usuário
    status: Mapped[str] = mapped_column(String(20), default="pending")
    email: Mapped[str] = mapped_column(String(300), default="")
    supervisor: Mapped[str] = mapped_column(String(300), default="")
    supervisor_email: Mapped[str] = mapped_column(String(300), default="")
    area: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class GpBancoHoras(Base):
    """Saldo acumulado de banco de horas por colaborador."""
    __tablename__ = "gp_banco_horas"

    matricula: Mapped[str] = mapped_column(String(50), primary_key=True)
    collaborator: Mapped[str] = mapped_column(String(300))
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    label: Mapped[str] = mapped_column(String(50), default="")
    critical: Mapped[bool] = mapped_column(Boolean, default=False)
    area: Mapped[str] = mapped_column(String(300), default="")
    supervisor: Mapped[str] = mapped_column(String(300), default="")
    supervisor_email: Mapped[str] = mapped_column(String(300), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GpImportacao(Base):
    """Metadados de cada importação de TXT."""
    __tablename__ = "gp_importacoes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(300))
    unidade: Mapped[str] = mapped_column(String(300), default="")
    period: Mapped[str | None] = mapped_column(String(100), nullable=True)
    people: Mapped[int] = mapped_column(Integer, default=0)
    daily_records: Mapped[int] = mapped_column(Integer, default=0)
    occurrences_total: Mapped[int] = mapped_column(Integer, default=0)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
