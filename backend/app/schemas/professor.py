from datetime import datetime
from pydantic import BaseModel


class ProfessorBase(BaseModel):
    nome: str
    cpf: str | None = None
    email: str | None = None
    telefone: str | None = None
    tipo: str  # Mensalista | Horista
    horas_contratadas: float
    valor_hora: float | None = None
    especialidades: str | None = None
    titulacao: str | None = None
    ativo: bool = True


class ProfessorCreate(ProfessorBase):
    pass


class ProfessorUpdate(BaseModel):
    nome: str | None = None
    email: str | None = None
    telefone: str | None = None
    tipo: str | None = None
    horas_contratadas: float | None = None
    valor_hora: float | None = None
    especialidades: str | None = None
    titulacao: str | None = None
    ativo: bool | None = None


class AtuacaoOut(BaseModel):
    id: int
    disciplina: str
    curso_id: int | None
    nivel_competencia: int

    model_config = {"from_attributes": True}


class DisponibilidadeOut(BaseModel):
    id: int
    dia_semana: int
    horario_inicio: str
    horario_fim: str
    tipo_disponibilidade: str

    model_config = {"from_attributes": True}


class RegenciaInfo(BaseModel):
    professor_id: int
    nome: str
    tipo: str
    horas_contratadas: float
    horas_ministradas: float
    percentual_regencia: float
    meta_regencia: float
    status: str  # OK | Alerta | Critico


class ProfessorOut(ProfessorBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    model_config = {"from_attributes": True}


class ProfessorComDetalhes(ProfessorOut):
    atuacoes: list[AtuacaoOut] = []
    disponibilidades: list[DisponibilidadeOut] = []
