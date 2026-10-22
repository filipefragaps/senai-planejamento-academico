"""CRM de Gestão de Leads — leads vindos das campanhas Meta (Facebook/Instagram)."""
from datetime import date, datetime
from sqlalchemy import String, ForeignKey, DateTime, Date, Text, JSON, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class CrmCampanha(Base):
    """Campanha/formulário de origem. Define a oferta (curso) e o vendedor padrão dos leads."""
    __tablename__ = "crm_campanhas"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    nome: Mapped[str] = mapped_column(String(300), nullable=False, unique=True, index=True)
    meta_campaign_id: Mapped[str | None] = mapped_column(String(100), index=True)
    oferta_id: Mapped[int | None] = mapped_column(ForeignKey("ofertas_cursos.id", ondelete="SET NULL"))
    vendedor_padrao_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    ativa: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    oferta: Mapped["OfertaCurso | None"] = relationship("OfertaCurso")
    vendedor_padrao: Mapped["Usuario | None"] = relationship("Usuario")


class CrmLead(Base):
    __tablename__ = "crm_leads"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # ── Dados de origem (Meta / importação) ──
    meta_lead_id: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    nome: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    telefone: Mapped[str | None] = mapped_column(String(30), index=True)
    email: Mapped[str | None] = mapped_column(String(200), index=True)
    campanha_id: Mapped[int | None] = mapped_column(ForeignKey("crm_campanhas.id", ondelete="SET NULL"), index=True)
    conjunto_anuncio: Mapped[str | None] = mapped_column(String(300))
    anuncio: Mapped[str | None] = mapped_column(String(300))
    formulario: Mapped[str | None] = mapped_column(String(300))
    plataforma: Mapped[str | None] = mapped_column(String(30))       # fb | ig
    origem: Mapped[str] = mapped_column(String(20), default="manual")  # meta | csv | manual
    recebido_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    dados_extras: Mapped[dict | None] = mapped_column(JSON)         # respostas adicionais do formulário

    # ── Acompanhamento comercial ──
    temperatura: Mapped[str | None] = mapped_column(String(10))        # quente | morno | frio
    status: Mapped[str] = mapped_column(String(30), default="novo", index=True)
    vendedor_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"), index=True)
    oferta_id: Mapped[int | None] = mapped_column(ForeignKey("ofertas_cursos.id", ondelete="SET NULL"), index=True)
    observacoes: Mapped[str | None] = mapped_column(Text)
    ultimo_contato: Mapped[date | None] = mapped_column(Date)
    proximo_retorno: Mapped[date | None] = mapped_column(Date, index=True)
    motivo_perda: Mapped[str | None] = mapped_column(String(50))
    motivo_perda_comentario: Mapped[str | None] = mapped_column(Text)
    data_matricula: Mapped[date | None] = mapped_column(Date)
    # A matrícula só é efetivada com o pagamento da 1ª parcela
    vencimento_primeira_parcela: Mapped[date | None] = mapped_column(Date, index=True)
    parcela_paga_em: Mapped[date | None] = mapped_column(Date)
    primeiro_atendimento_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    campanha: Mapped["CrmCampanha | None"] = relationship("CrmCampanha")
    vendedor: Mapped["Usuario | None"] = relationship("Usuario")
    oferta: Mapped["OfertaCurso | None"] = relationship("OfertaCurso")
    historico: Mapped[list["CrmHistorico"]] = relationship(
        "CrmHistorico", back_populates="lead", cascade="all, delete-orphan", order_by="CrmHistorico.id.desc()"
    )


class CrmHistorico(Base):
    """Linha do tempo do lead: cada alteração de campo ou anotação do vendedor."""
    __tablename__ = "crm_historico"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("crm_leads.id", ondelete="CASCADE"), nullable=False, index=True)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    usuario_nome: Mapped[str | None] = mapped_column(String(200))
    campo: Mapped[str] = mapped_column(String(50), nullable=False)   # status | temperatura | ... | nota | criacao
    valor_anterior: Mapped[str | None] = mapped_column(Text)
    valor_novo: Mapped[str | None] = mapped_column(Text)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    lead: Mapped["CrmLead"] = relationship("CrmLead", back_populates="historico")


class CrmConfig(Base):
    """Configurações do CRM em chave/valor (horas de alerta, rodízio de vendedores, Meta)."""
    __tablename__ = "crm_config"

    chave: Mapped[str] = mapped_column(String(100), primary_key=True)
    valor: Mapped[str | None] = mapped_column(Text)
