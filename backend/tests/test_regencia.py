"""
Testes unitários da lógica de regência docente.

Cobre:
- calcular_status_regencia() — todas as faixas para Mensalista e Horista
- calcular_regencia_professor() — cálculo com aulas reais no banco de teste
- calcular_regencia_todos() — agrega múltiplos professores
"""
from datetime import date, time
import pytest

from app.services.regencia import (
    calcular_status_regencia,
    calcular_regencia_professor,
    calcular_regencia_todos,
    META_REGENCIA_MENSALISTA,
    ALERTA_INFERIOR,
    ALERTA_SUPERIOR,
)


# ── calcular_status_regencia ──────────────────────────────────────────────────

class TestStatusRegencia:
    def test_mensalista_critico(self):
        assert calcular_status_regencia(0.0, "Mensalista") == "Critico"
        assert calcular_status_regencia(0.49, "Mensalista") == "Critico"

    def test_mensalista_alerta(self):
        assert calcular_status_regencia(0.50, "Mensalista") == "Alerta"
        assert calcular_status_regencia(0.65, "Mensalista") == "Alerta"
        assert calcular_status_regencia(0.699, "Mensalista") == "Alerta"

    def test_mensalista_ok(self):
        assert calcular_status_regencia(0.70, "Mensalista") == "OK"
        assert calcular_status_regencia(0.85, "Mensalista") == "OK"
        assert calcular_status_regencia(0.90, "Mensalista") == "OK"

    def test_mensalista_sobrecarga(self):
        assert calcular_status_regencia(0.901, "Mensalista") == "Sobrecarga"
        assert calcular_status_regencia(1.20, "Mensalista") == "Sobrecarga"

    def test_horista_baixa_carga(self):
        assert calcular_status_regencia(0.0, "Horista") == "Baixa carga"
        assert calcular_status_regencia(0.49, "Horista") == "Baixa carga"

    def test_horista_ok(self):
        assert calcular_status_regencia(0.50, "Horista") == "OK"
        assert calcular_status_regencia(0.89, "Horista") == "OK"

    def test_horista_alta_carga(self):
        assert calcular_status_regencia(0.91, "Horista") == "Alta carga"

    def test_limites_constantes_coerentes(self):
        """Garante que as constantes do módulo são consistentes com os limites testados."""
        assert ALERTA_INFERIOR == 0.50
        assert META_REGENCIA_MENSALISTA == 0.70
        assert ALERTA_SUPERIOR == 0.90


# ── calcular_regencia_professor ───────────────────────────────────────────────

class TestCalcularRegenciaProfessor:
    async def test_sem_aulas_retorna_zero(self, db_session, professor_mensalista):
        inicio = date(2025, 1, 1)
        fim = date(2025, 1, 31)
        result = await calcular_regencia_professor(professor_mensalista, db_session, inicio, fim)

        assert result["professor_id"] == professor_mensalista.id
        assert result["nome"] == professor_mensalista.nome
        assert result["horas_ministradas"] == 0.0
        assert result["percentual_regencia"] == 0.0
        assert result["status"] == "Critico"
        assert result["periodo_inicio"] == "2025-01-01"
        assert result["periodo_fim"] == "2025-01-31"

    async def test_mensalista_com_aulas_calcula_percentual(self, db_session, professor_mensalista):
        """
        40h/sem × 4 semanas = 160h no período.
        3 aulas de 2h cada = 6h → 3,75%.
        """
        from app.models.aula import Aula
        from app.models.evento import Evento

        # Precisa de um Evento para FK
        evento = Evento(
            nome_turma="Turma Teste",
            disciplina="UC Teste",
            professor_id=professor_mensalista.id,
            data_inicio=date(2025, 1, 1),
            data_fim=date(2025, 1, 31),
            horario_inicio=time(8, 0),
            horario_fim=time(10, 0),
            dias_semana=[0, 2, 4],
            horas_semanais=6.0,
            carga_horaria_total=60.0,
        )
        db_session.add(evento)
        await db_session.flush()

        for d in [date(2025, 1, 6), date(2025, 1, 8), date(2025, 1, 10)]:
            aula = Aula(
                evento_id=evento.id,
                professor_id=professor_mensalista.id,
                data=d,
                horario_inicio=time(8, 0),
                horario_fim=time(10, 0),
                status="Realizada",
            )
            db_session.add(aula)
        await db_session.flush()

        inicio = date(2025, 1, 1)
        fim = date(2025, 1, 31)
        result = await calcular_regencia_professor(professor_mensalista, db_session, inicio, fim)

        assert result["horas_ministradas"] == pytest.approx(6.0, abs=0.01)
        # (31-1=30 dias) / 7 = 4.28 semanas × 40h = 171.4h; 6/171.4 ≈ 3.5%
        semanas = 30 / 7
        esperado = round(6.0 / (40 * semanas) * 100, 2)
        assert result["percentual_regencia"] == pytest.approx(esperado, abs=0.1)
        assert result["status"] == "Critico"
        assert result["meta_regencia"] == 70.0

    async def test_mensalista_atingindo_meta(self, db_session, professor_mensalista):
        """Professor com exatamente 70% de regência deve ter status OK."""
        from app.models.aula import Aula
        from app.models.evento import Evento

        inicio = date(2025, 2, 3)   # Segunda — semana única
        fim = date(2025, 2, 9)      # Domingo

        evento = Evento(
            nome_turma="Turma Meta",
            disciplina="UC Meta",
            professor_id=professor_mensalista.id,
            data_inicio=inicio,
            data_fim=fim,
            horario_inicio=time(7, 0),
            horario_fim=time(11, 0),
            dias_semana=[0, 1, 2, 3, 4],
            horas_semanais=20.0,
            carga_horaria_total=80.0,
        )
        db_session.add(evento)
        await db_session.flush()

        # 40h/sem × 1 semana = 40h de referência; 70% = 28h → 7 aulas de 4h
        for d in [date(2025, 2, 3), date(2025, 2, 4), date(2025, 2, 5),
                  date(2025, 2, 6), date(2025, 2, 7)]:
            for _ in range(1 if d < date(2025, 2, 6) else 0):
                pass
            aula = Aula(
                evento_id=evento.id,
                professor_id=professor_mensalista.id,
                data=d,
                horario_inicio=time(7, 0),
                horario_fim=time(12, 36),   # 5h 36min = 5.6h × 5 dias = 28h
                status="Realizada",
            )
            db_session.add(aula)
        await db_session.flush()

        result = await calcular_regencia_professor(professor_mensalista, db_session, inicio, fim)
        assert result["percentual_regencia"] >= 70.0
        assert result["status"] == "OK"

    async def test_aulas_canceladas_nao_contam(self, db_session, professor_mensalista):
        """Aulas Canceladas não devem ser somadas nas horas ministradas."""
        from app.models.aula import Aula
        from app.models.evento import Evento

        inicio = date(2025, 3, 3)
        fim = date(2025, 3, 9)

        evento = Evento(
            nome_turma="Turma Cancelada",
            disciplina="UC Cancelada",
            professor_id=professor_mensalista.id,
            data_inicio=inicio,
            data_fim=fim,
            horario_inicio=time(8, 0),
            horario_fim=time(10, 0),
            dias_semana=[0],
            horas_semanais=2.0,
            carga_horaria_total=8.0,
        )
        db_session.add(evento)
        await db_session.flush()

        aula_cancelada = Aula(
            evento_id=evento.id,
            professor_id=professor_mensalista.id,
            data=date(2025, 3, 3),
            horario_inicio=time(8, 0),
            horario_fim=time(10, 0),
            status="Cancelada",
        )
        db_session.add(aula_cancelada)
        await db_session.flush()

        result = await calcular_regencia_professor(professor_mensalista, db_session, inicio, fim)
        assert result["horas_ministradas"] == 0.0

    async def test_horista_calcula_remuneracao(self, db_session, professor_horista):
        """Horista deve ter remuneracao_horista calculado = horas × valor_hora."""
        from app.models.aula import Aula
        from app.models.evento import Evento

        inicio = date(2025, 4, 7)
        fim = date(2025, 4, 13)

        evento = Evento(
            nome_turma="Turma Horista",
            disciplina="UC Horista",
            professor_id=professor_horista.id,
            data_inicio=inicio,
            data_fim=fim,
            horario_inicio=time(13, 0),
            horario_fim=time(17, 0),
            dias_semana=[0, 2],
            horas_semanais=8.0,
            carga_horaria_total=32.0,
        )
        db_session.add(evento)
        await db_session.flush()

        for d in [date(2025, 4, 7), date(2025, 4, 9)]:  # 2 aulas × 4h = 8h
            aula = Aula(
                evento_id=evento.id,
                professor_id=professor_horista.id,
                data=d,
                horario_inicio=time(13, 0),
                horario_fim=time(17, 0),
                status="Realizada",
            )
            db_session.add(aula)
        await db_session.flush()

        result = await calcular_regencia_professor(professor_horista, db_session, inicio, fim)
        assert result["horas_ministradas"] == pytest.approx(8.0, abs=0.01)
        # 8h × R$50 = R$400
        assert result["remuneracao_horista"] == pytest.approx(400.0, abs=0.01)


# ── calcular_regencia_todos ───────────────────────────────────────────────────

class TestCalcularRegenciaTodos:
    async def test_retorna_todos_professores_ativos(self, db_session, professor_mensalista, professor_horista):
        inicio = date(2025, 5, 1)
        fim = date(2025, 5, 31)
        resultados = await calcular_regencia_todos(db_session, inicio, fim)

        ids = {r["professor_id"] for r in resultados}
        assert professor_mensalista.id in ids
        assert professor_horista.id in ids

    async def test_resultado_ordenado_por_percentual_crescente(
        self, db_session, professor_mensalista, professor_horista
    ):
        """O resultado deve vir ordenado do menor para o maior percentual."""
        inicio = date(2025, 6, 1)
        fim = date(2025, 6, 30)
        resultados = await calcular_regencia_todos(db_session, inicio, fim)

        percentuais = [r["percentual_regencia"] for r in resultados]
        assert percentuais == sorted(percentuais)
