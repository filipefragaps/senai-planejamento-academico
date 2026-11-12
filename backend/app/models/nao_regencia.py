"""Gestão da Não Regência Docente: projetos e atividades fora da sala de aula, alocação de professores,
entregas, apontamento de horas e histórico. Módulo independente: só lê professores, aulas e calendário."""
from datetime import date, datetime
from sqlalchemy import (
    JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class NrCategoria(Base):
    __tablename__ = "nr_categorias"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome: Mapped[str] = mapped_column(String(150), nullable=False, unique=True)
    ativa: Mapped[bool] = mapped_column(Boolean, default=True)
    ordem: Mapped[int] = mapped_column(Integer, default=0)


class NrConfig(Base):
    """Parâmetros do módulo em chave/valor (limites de alertas e regras institucionais)."""
    __tablename__ = "nr_config"

    chave: Mapped[str] = mapped_column(String(100), primary_key=True)
    valor: Mapped[str | None] = mapped_column(Text)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class NrProjeto(Base):
    __tablename__ = "nr_projetos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    codigo: Mapped[str | None] = mapped_column(String(30), unique=True, index=True)
    nome: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("nr_categorias.id", ondelete="SET NULL"), index=True)
    descricao: Mapped[str | None] = mapped_column(Text)
    justificativa: Mapped[str | None] = mapped_column(Text)
    objetivo: Mapped[str | None] = mapped_column(Text)
    resultados_esperados: Mapped[str | None] = mapped_column(Text)
    unidade: Mapped[str | None] = mapped_column(String(200), index=True)
    responsavel_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"), index=True)
    data_inicio: Mapped[date | None] = mapped_column(Date)
    data_fim_prevista: Mapped[date | None] = mapped_column(Date)
    data_conclusao: Mapped[date | None] = mapped_column(Date)
    continuo: Mapped[bool] = mapped_column(Boolean, default=False)   # atividade contínua (sem prazo final)
    data_revisao: Mapped[date | None] = mapped_column(Date)          # obrigatória para atividade contínua
    situacao: Mapped[str] = mapped_column(String(20), default="rascunho", index=True)
    prioridade: Mapped[str] = mapped_column(String(10), default="media")
    ch_total_prevista: Mapped[float | None] = mapped_column(Float)
    entregas_previstas: Mapped[str | None] = mapped_column(Text)     # texto livre; as entregas formais ficam em nr_entregas
    links: Mapped[list | None] = mapped_column(JSON)                 # [{"titulo", "url"}]
    observacoes: Mapped[str | None] = mapped_column(Text)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    categoria: Mapped["NrCategoria | None"] = relationship("NrCategoria")
    responsavel: Mapped["Usuario | None"] = relationship("Usuario", foreign_keys=[responsavel_id])
    vinculos: Mapped[list["NrVinculo"]] = relationship("NrVinculo", back_populates="projeto", cascade="all, delete-orphan")
    entregas: Mapped[list["NrEntrega"]] = relationship("NrEntrega", back_populates="projeto", cascade="all, delete-orphan",
                                                      order_by="NrEntrega.prazo")


class NrVinculo(Base):
    """Participação de um professor num projeto, com carga semanal (e faixas por período, se mudar)."""
    __tablename__ = "nr_vinculos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    projeto_id: Mapped[int] = mapped_column(ForeignKey("nr_projetos.id", ondelete="CASCADE"), nullable=False, index=True)
    professor_id: Mapped[int] = mapped_column(ForeignKey("professores.id", ondelete="CASCADE"), nullable=False, index=True)
    papel: Mapped[str | None] = mapped_column(String(150))
    contribuicao: Mapped[str | None] = mapped_column(Text)
    data_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    data_fim: Mapped[date | None] = mapped_column(Date)
    horas_semanais: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    responsabilidades: Mapped[str | None] = mapped_column(Text)
    gestor_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    situacao: Mapped[str] = mapped_column(String(20), default="proposta", index=True)  # proposta | aprovada | encerrada | cancelada
    justificativa: Mapped[str | None] = mapped_column(Text)
    aprovado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    aprovado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    projeto: Mapped["NrProjeto"] = relationship("NrProjeto", back_populates="vinculos")
    professor: Mapped["Professor"] = relationship("Professor")
    gestor: Mapped["Usuario | None"] = relationship("Usuario", foreign_keys=[gestor_id])
    periodos: Mapped[list["NrVinculoPeriodo"]] = relationship(
        "NrVinculoPeriodo", back_populates="vinculo", cascade="all, delete-orphan", order_by="NrVinculoPeriodo.data_inicio"
    )


class NrVinculoPeriodo(Base):
    """Faixa de carga semanal diferente da padrão do vínculo (ex.: 4h/sem em março, 8h/sem a partir de abril)."""
    __tablename__ = "nr_vinculo_periodos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    vinculo_id: Mapped[int] = mapped_column(ForeignKey("nr_vinculos.id", ondelete="CASCADE"), nullable=False, index=True)
    data_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    data_fim: Mapped[date | None] = mapped_column(Date)
    horas_semanais: Mapped[float] = mapped_column(Float, nullable=False)

    vinculo: Mapped["NrVinculo"] = relationship("NrVinculo", back_populates="periodos")


class NrEntrega(Base):
    __tablename__ = "nr_entregas"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    projeto_id: Mapped[int] = mapped_column(ForeignKey("nr_projetos.id", ondelete="CASCADE"), nullable=False, index=True)
    titulo: Mapped[str] = mapped_column(String(300), nullable=False)
    descricao: Mapped[str | None] = mapped_column(Text)
    responsaveis: Mapped[list | None] = mapped_column(JSON)   # ids de professores
    prazo: Mapped[date | None] = mapped_column(Date, index=True)
    criterio_aceite: Mapped[str | None] = mapped_column(Text)
    peso: Mapped[float | None] = mapped_column(Float)
    situacao: Mapped[str] = mapped_column(String(20), default="nao_iniciada", index=True)
    data_submissao: Mapped[date | None] = mapped_column(Date)
    data_aprovacao: Mapped[date | None] = mapped_column(Date)
    evidencias: Mapped[str | None] = mapped_column(Text)
    links: Mapped[list | None] = mapped_column(JSON)
    parecer: Mapped[str | None] = mapped_column(Text)
    submetido_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    validado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    projeto: Mapped["NrProjeto"] = relationship("NrProjeto", back_populates="entregas")


class NrApontamento(Base):
    """Horas informadas pelo professor num dia (data_inicio == data_fim) ou num período (lançamento semanal)."""
    __tablename__ = "nr_apontamentos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    projeto_id: Mapped[int] = mapped_column(ForeignKey("nr_projetos.id", ondelete="CASCADE"), nullable=False, index=True)
    professor_id: Mapped[int] = mapped_column(ForeignKey("professores.id", ondelete="CASCADE"), nullable=False, index=True)
    data_inicio: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    data_fim: Mapped[date] = mapped_column(Date, nullable=False)
    horas: Mapped[float] = mapped_column(Float, nullable=False)
    descricao: Mapped[str] = mapped_column(Text, nullable=False)
    entrega_id: Mapped[int | None] = mapped_column(ForeignKey("nr_entregas.id", ondelete="SET NULL"))
    evidencia: Mapped[str | None] = mapped_column(Text)
    situacao: Mapped[str] = mapped_column(String(20), default="rascunho", index=True)  # rascunho | enviado | aprovado | devolvido
    enviado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    validado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    validado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parecer: Mapped[str | None] = mapped_column(Text)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    projeto: Mapped["NrProjeto"] = relationship("NrProjeto")
    professor: Mapped["Professor"] = relationship("Professor")
    entrega: Mapped["NrEntrega | None"] = relationship("NrEntrega")


class NrAfastamento(Base):
    """Período em que o professor está indisponível (férias, licença, afastamento...)."""
    __tablename__ = "nr_afastamentos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    professor_id: Mapped[int] = mapped_column(ForeignKey("professores.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(50), nullable=False)
    data_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    data_fim: Mapped[date] = mapped_column(Date, nullable=False)
    observacao: Mapped[str | None] = mapped_column(Text)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    professor: Mapped["Professor"] = relationship("Professor")


class NrOutraAlocacao(Base):
    """Outras alocações institucionais do professor que consomem carga (ex.: comissão permanente, apoio à secretaria)."""
    __tablename__ = "nr_outras_alocacoes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    professor_id: Mapped[int] = mapped_column(ForeignKey("professores.id", ondelete="CASCADE"), nullable=False, index=True)
    descricao: Mapped[str] = mapped_column(String(300), nullable=False)
    data_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    data_fim: Mapped[date | None] = mapped_column(Date)
    horas_semanais: Mapped[float] = mapped_column(Float, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    professor: Mapped["Professor"] = relationship("Professor")


class NrAnexo(Base):
    """Arquivo anexado a um projeto, entrega ou apontamento (conteúdo em base64, até o limite configurado na API)."""
    __tablename__ = "nr_anexos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    projeto_id: Mapped[int] = mapped_column(ForeignKey("nr_projetos.id", ondelete="CASCADE"), nullable=False, index=True)
    entrega_id: Mapped[int | None] = mapped_column(ForeignKey("nr_entregas.id", ondelete="CASCADE"), index=True)
    apontamento_id: Mapped[int | None] = mapped_column(ForeignKey("nr_apontamentos.id", ondelete="CASCADE"), index=True)
    nome: Mapped[str] = mapped_column(String(300), nullable=False)
    mime: Mapped[str | None] = mapped_column(String(150))
    tamanho: Mapped[int] = mapped_column(Integer, default=0)
    conteudo: Mapped[str] = mapped_column(Text, nullable=False)
    enviado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NrHistorico(Base):
    """Trilha de auditoria: criação, alterações, aprovações, devoluções e encerramentos."""
    __tablename__ = "nr_historico"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    projeto_id: Mapped[int | None] = mapped_column(ForeignKey("nr_projetos.id", ondelete="CASCADE"), index=True)
    entidade: Mapped[str] = mapped_column(String(30), nullable=False)   # projeto | vinculo | entrega | apontamento | ...
    entidade_id: Mapped[int | None] = mapped_column(Integer)
    acao: Mapped[str] = mapped_column(String(40), nullable=False)
    detalhe: Mapped[str | None] = mapped_column(Text)
    justificativa: Mapped[str | None] = mapped_column(Text)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    usuario_nome: Mapped[str | None] = mapped_column(String(200))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
