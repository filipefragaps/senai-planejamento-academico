"""
Testes de integração dos endpoints principais da API.

Cobre:
- POST /api/v1/auth/login — credenciais válidas e inválidas
- GET  /api/v1/auth/me — token válido e sem token
- GET  /api/v1/professores/ — listagem com autenticação
- POST /api/v1/professores/ — criação e validação
- GET  /api/v1/professores/regencia — agregação de regência
- GET  /api/v1/planejamento/cronograma — paginação e filtros básicos
"""
from datetime import date, time
import pytest


# ── Autenticação ──────────────────────────────────────────────────────────────

class TestLogin:
    async def test_login_credenciais_validas(self, client, admin_user):
        """Login com email/senha corretos retorna token JWT."""
        res = await client.post("/api/v1/auth/login", json={
            "email": admin_user.email,
            "senha": "Senha@123",
        })
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["perfil"] == "admin"
        assert data["usuario_email"] == admin_user.email

    async def test_login_senha_errada(self, client, admin_user):
        """Senha incorreta retorna 401."""
        res = await client.post("/api/v1/auth/login", json={
            "email": admin_user.email,
            "senha": "SenhaErrada",
        })
        assert res.status_code == 401

    async def test_login_email_inexistente(self, client):
        """Email não cadastrado retorna 401 (não revela que o email não existe)."""
        res = await client.post("/api/v1/auth/login", json={
            "email": "naocadastrado@teste.com",
            "senha": "Qualquer123",
        })
        assert res.status_code == 401

    async def test_me_com_token_valido(self, auth_client, admin_user):
        """GET /me com token válido retorna dados do usuário logado."""
        res = await auth_client.get("/api/v1/auth/me")
        assert res.status_code == 200
        data = res.json()
        assert data["email"] == admin_user.email
        assert data["perfil"] == "admin"

    async def test_me_sem_token_retorna_403(self, client):
        """GET /me sem Authorization retorna 403 (HTTPBearer rejeita)."""
        res = await client.get("/api/v1/auth/me")
        assert res.status_code in (401, 403)


# ── Professores ───────────────────────────────────────────────────────────────

class TestProfessores:
    async def test_listar_professores_requer_auth(self, client):
        """Endpoint protegido retorna 401/403 sem token."""
        res = await client.get("/api/v1/professores/")
        assert res.status_code in (401, 403)

    async def test_listar_professores_vazio(self, auth_client):
        """Com banco limpo, lista de professores é uma lista vazia."""
        res = await auth_client.get("/api/v1/professores/")
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    async def test_criar_professor_mensalista(self, auth_client):
        """Criação de professor mensalista retorna 200/201 com id gerado."""
        res = await auth_client.post("/api/v1/professores/", json={
            "nome": "Prof Integração",
            "tipo": "Mensalista",
            "horas_contratadas": 40,
            "ativo": True,
        })
        assert res.status_code in (200, 201)
        data = res.json()
        assert data["nome"] == "Prof Integração"
        assert data["tipo"] == "Mensalista"
        assert "id" in data

    async def test_professor_criado_aparece_na_listagem(self, auth_client):
        """Professor criado deve aparecer em GET /professores/."""
        await auth_client.post("/api/v1/professores/", json={
            "nome": "Prof Listagem",
            "tipo": "Horista",
            "horas_contratadas": 20,
        })
        res = await auth_client.get("/api/v1/professores/")
        assert res.status_code == 200
        nomes = [p["nome"] for p in res.json()]
        assert "Prof Listagem" in nomes

    async def test_criar_professor_sem_campos_obrigatorios(self, auth_client):
        """Payload incompleto deve retornar 422."""
        res = await auth_client.post("/api/v1/professores/", json={
            "nome": "Incompleto",
            # falta tipo e horas_contratadas
        })
        assert res.status_code == 422


# ── Regência ──────────────────────────────────────────────────────────────────

class TestRegencia:
    async def test_regencia_retorna_lista(self, auth_client, db_session):
        """GET /professores/regencia retorna lista (vazia ok se não há professores)."""
        res = await auth_client.get("/api/v1/professores/regencia")
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    async def test_regencia_professor_especifico(self, auth_client, professor_mensalista):
        """GET /professores/{id}/regencia retorna dados do professor."""
        res = await auth_client.get(f"/api/v1/professores/{professor_mensalista.id}/regencia")
        assert res.status_code == 200
        data = res.json()
        assert data["professor_id"] == professor_mensalista.id
        assert "percentual_regencia" in data
        assert "status" in data
        assert "horas_ministradas" in data

    async def test_regencia_professor_inexistente(self, auth_client):
        """Professor com ID inexistente retorna 404."""
        res = await auth_client.get("/api/v1/professores/999999/regencia")
        assert res.status_code == 404

    async def test_regencia_aceita_filtro_periodo(self, auth_client, professor_mensalista):
        """Endpoint deve aceitar query params data_inicio e data_fim."""
        res = await auth_client.get(
            f"/api/v1/professores/{professor_mensalista.id}/regencia",
            params={"data_inicio": "2025-01-01", "data_fim": "2025-01-31"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["periodo_inicio"] == "2025-01-01"
        assert data["periodo_fim"] == "2025-01-31"


# ── Cronograma ────────────────────────────────────────────────────────────────

class TestCronograma:
    async def test_cronograma_retorna_lista(self, auth_client):
        """GET /planejamento/cronograma retorna lista (vazia ok)."""
        res = await auth_client.get("/api/v1/planejamento/cronograma")
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    async def test_cronograma_com_aula_criada(self, auth_client, db_session, professor_mensalista):
        """Aula inserida diretamente deve aparecer no cronograma."""
        from app.models.aula import Aula
        from app.models.evento import Evento

        evento = Evento(
            nome_turma="Turma Integração",
            disciplina="UC Integração",
            professor_id=professor_mensalista.id,
            data_inicio=date(2025, 7, 1),
            data_fim=date(2025, 7, 31),
            horario_inicio=time(8, 0),
            horario_fim=time(10, 0),
            dias_semana=[0, 2, 4],
            horas_semanais=6.0,
            carga_horaria_total=24.0,
        )
        db_session.add(evento)
        await db_session.flush()

        aula = Aula(
            evento_id=evento.id,
            professor_id=professor_mensalista.id,
            data=date(2025, 7, 7),
            horario_inicio=time(8, 0),
            horario_fim=time(10, 0),
            status="Agendada",
        )
        db_session.add(aula)
        await db_session.flush()

        res = await auth_client.get("/api/v1/planejamento/cronograma", params={
            "professor_id": professor_mensalista.id,
            "data_inicio": "2025-07-01",
            "data_fim": "2025-07-31",
        })
        assert res.status_code == 200
        aulas = res.json()
        assert len(aulas) >= 1
        assert any(a["data"] == "2025-07-07" for a in aulas)

    async def test_cronograma_filtro_status(self, auth_client):
        """Filtro por status deve ser aceito sem erro."""
        res = await auth_client.get("/api/v1/planejamento/cronograma", params={"status": "Agendada"})
        assert res.status_code == 200

    async def test_cronograma_paginacao(self, auth_client):
        """Parâmetros skip e limit devem ser aceitos."""
        res = await auth_client.get("/api/v1/planejamento/cronograma", params={"skip": 0, "limit": 10})
        assert res.status_code == 200
        assert isinstance(res.json(), list)
        assert len(res.json()) <= 10
