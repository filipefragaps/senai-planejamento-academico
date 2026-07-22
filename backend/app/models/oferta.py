from datetime import datetime, date, time
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Date, Time, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class OfertaCurso(Base):
    """Oferta de curso importada da planilha de eventos do SENAI."""
    __tablename__ = "ofertas_cursos"
    __table_args__ = (UniqueConstraint("codigo_evento", name="uq_oferta_evento"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    codigo_evento: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    semestre: Mapped[int] = mapped_column(Integer, default=1)  # 1 ou 2

    modalidade: Mapped[str] = mapped_column(String(80), nullable=False)
    area: Mapped[str | None] = mapped_column(String(100))
    pasta: Mapped[str | None] = mapped_column(String(30))
    curso_id: Mapped[int | None] = mapped_column(ForeignKey("cursos.id", ondelete="SET NULL"))
    nome_curso: Mapped[str] = mapped_column(String(300), nullable=False)

    turno: Mapped[str | None] = mapped_column(String(30))
    dias_semana_texto: Mapped[str | None] = mapped_column(String(100))
    cidade: Mapped[str | None] = mapped_column(String(100))
    carga_horaria: Mapped[int] = mapped_column(Integer, default=0)
    hora_inicio: Mapped[time | None] = mapped_column(Time)
    hora_termino: Mapped[time | None] = mapped_column(Time)
    data_inicio: Mapped[date | None] = mapped_column(Date)
    data_termino: Mapped[date | None] = mapped_column(Date)

    status: Mapped[str] = mapped_column(String(30), default="")
    vagas: Mapped[int] = mapped_column(Integer, default=0)
    min_para_inicio: Mapped[int] = mapped_column(Integer, default=0)
    parcelas_boleto: Mapped[int | None] = mapped_column(Integer)
    valor_individual: Mapped[float | None] = mapped_column(Float)
    parcela_com_desconto: Mapped[float | None] = mapped_column(Float)
    total_por_aluno: Mapped[float | None] = mapped_column(Float)
    hora_aula: Mapped[int | None] = mapped_column(Integer)
    alunos_matriculados: Mapped[int] = mapped_column(Integer, default=0)
    previsao_inicio: Mapped[str | None] = mapped_column(String(100))
    execucao: Mapped[str | None] = mapped_column(String(100))
    status_cronograma: Mapped[str | None] = mapped_column(String(100))

    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    curso: Mapped["Curso | None"] = relationship("Curso")
