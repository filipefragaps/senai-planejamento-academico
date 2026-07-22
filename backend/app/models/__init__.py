from app.models.usuario import Usuario
from app.models.curso import Curso
from app.models.unidade_curricular import UnidadeCurricular
from app.models.professor import Professor
from app.models.atuacao import Atuacao
from app.models.disponibilidade import DisponibilidadeDetalhada
from app.models.calendario import CalendarioAcademico
from app.models.evento import Evento
from app.models.aula import Aula
from app.models.versao import VersaoCronograma
from app.models.oferta import OfertaCurso

__all__ = [
    "Usuario",
    "Curso",
    "UnidadeCurricular",
    "Professor",
    "Atuacao",
    "DisponibilidadeDetalhada",
    "CalendarioAcademico",
    "Evento",
    "Aula",
    "VersaoCronograma",
    "OfertaCurso",
]
