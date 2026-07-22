from datetime import datetime, date, time
from pydantic import BaseModel
from typing import Any


class EventoBase(BaseModel):
    nome_turma: str
    curso_id: int | None = None
    oferta_id: int | None = None
    disciplina: str
    carga_horaria_total: float
    horas_semanais: float
    data_inicio: date
    data_fim: date
    dias_semana: list[int]  # [0,2,4] = seg,qua,sex
    horario_inicio: time
    horario_fim: time
    professor_id: int | None = None
    sala: str | None = None
    modalidade: str = "Presencial"
    status: str = "Planejado"
    observacoes: str | None = None


class EventoCreate(EventoBase):
    gerar_aulas: bool = True  # Auto-generate aula records


class EventoUpdate(BaseModel):
    nome_turma: str | None = None
    professor_id: int | None = None
    sala: str | None = None
    status: str | None = None
    observacoes: str | None = None
    horas_semanais: float | None = None
    data_fim: date | None = None


class EventoOut(EventoBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    model_config = {"from_attributes": True}


class EventoComAulas(EventoOut):
    aulas: list["AulaOut"] = []


class AulaBase(BaseModel):
    evento_id: int
    professor_id: int | None = None
    data: date
    horario_inicio: time
    horario_fim: time
    sala: str | None = None
    status: str = "Agendada"
    tipo: str = "Regular"
    observacoes: str | None = None


class AulaCreate(AulaBase):
    pass


class AulaUpdate(BaseModel):
    professor_id: int | None = None
    unidade_curricular_id: int | None = None
    data: date | None = None
    horario_inicio: time | None = None
    horario_fim: time | None = None
    sala: str | None = None
    ambiente: str | None = None
    status: str | None = None
    tipo: str | None = None
    observacoes: str | None = None
    motivo: str | None = None  # For change log


class AulaOut(AulaBase):
    id: int
    alterada_manualmente: bool
    dados_anteriores: dict | None = None
    criado_em: datetime
    atualizado_em: datetime

    model_config = {"from_attributes": True}


class ReplanejamentoRequest(BaseModel):
    aula_id: int
    alteracoes: AulaUpdate
    replaneja_futuras: bool = True
    motivo: str | None = None


class ReplanejamentoResponse(BaseModel):
    aula_alterada: AulaOut
    aulas_replanejadas: list[AulaOut]
    conflitos_detectados: list[dict]
    sugestoes_ia: list[str] = []
