from pydantic import BaseModel


class KPIProfessor(BaseModel):
    professor_id: int
    nome: str
    tipo: str
    horas_contratadas: float
    horas_ministradas_semana: float
    horas_ministradas_total: float
    percentual_regencia: float
    meta_regencia: float
    status_regencia: str  # OK | Alerta | Critico
    total_aulas_agendadas: int
    total_aulas_realizadas: int


class KPITurma(BaseModel):
    evento_id: int
    nome_turma: str
    disciplina: str
    professor_nome: str | None
    progresso_percentual: float
    aulas_realizadas: int
    aulas_totais: int
    horas_concluidas: float
    horas_totais: float
    status: str


class KPIGlobal(BaseModel):
    total_professores_ativos: int
    total_turmas_ativas: int
    total_aulas_semana: int
    taxa_regencia_media: float
    professores_criticos: int  # regencia < 50%
    professores_alerta: int    # regencia 50-70%
    professores_ok: int        # regencia >= 70%
    aulas_proxima_semana: int
    conflitos_detectados: int


class DashboardData(BaseModel):
    global_kpis: KPIGlobal
    professores: list[KPIProfessor]
    turmas: list[KPITurma]
    alertas: list[dict]
