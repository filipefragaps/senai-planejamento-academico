from datetime import datetime
from pydantic import BaseModel


class CursoBase(BaseModel):
    nome: str
    codigo: str
    carga_horaria_total: int
    tipo: str = "Habilitação Técnica"
    modalidade: str = "Presencial"
    area: str | None = None
    descricao: str | None = None
    ativo: bool = True


class CursoCreate(CursoBase):
    pass


class CursoUpdate(BaseModel):
    nome: str | None = None
    carga_horaria_total: int | None = None
    tipo: str | None = None
    modalidade: str | None = None
    area: str | None = None
    descricao: str | None = None
    ativo: bool | None = None


class CursoOut(CursoBase):
    id: int
    criado_em: datetime | None = None
    atualizado_em: datetime | None = None

    model_config = {"from_attributes": True}


# ── Unidade Curricular schemas ─────────────────────────────────────────────────

class UCCreate(BaseModel):
    nome: str
    codigo_uc: str = ""
    tipo: str = "Presencial"
    modulo_etapa: str | None = None
    sequencia: int | None = None
    carga_horaria: int = 0


class UCUpdate(BaseModel):
    nome: str | None = None
    codigo_uc: str | None = None
    tipo: str | None = None
    modulo_etapa: str | None = None
    sequencia: int | None = None
    carga_horaria: int | None = None


class UCReorderItem(BaseModel):
    id: int
    sequencia: int
    modulo_etapa: str | None = None


class UCOut(BaseModel):
    id: int
    curso_id: int
    codigo_uc: str
    nome: str
    tipo: str
    modulo_etapa: str | None
    sequencia: int | None
    carga_horaria: int

    model_config = {"from_attributes": True}
