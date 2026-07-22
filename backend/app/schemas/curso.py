from datetime import datetime
from pydantic import BaseModel


class CursoBase(BaseModel):
    nome: str
    codigo: str
    carga_horaria_total: int
    modalidade: str = "Presencial"
    area: str | None = None
    descricao: str | None = None
    ativo: bool = True


class CursoCreate(CursoBase):
    pass


class CursoUpdate(BaseModel):
    nome: str | None = None
    carga_horaria_total: int | None = None
    modalidade: str | None = None
    area: str | None = None
    descricao: str | None = None
    ativo: bool | None = None


class CursoOut(CursoBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    model_config = {"from_attributes": True}
