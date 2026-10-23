"""Coordenadores de curso cadastrados em Professores."""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import Base
from app.main import _seed_coordenadores
from app.models.oferta import OfertaCurso
from app.models.professor import Professor


async def test_marcar_coordenador_e_listas(auth_client, db_session):
    p1 = Professor(nome="Ana Coordenadora", tipo="Mensalista", horas_contratadas=40, ativo=True)
    p2 = Professor(nome="Bruno Docente", tipo="Horista", horas_contratadas=20, ativo=True)
    p3 = Professor(nome="Carla Inativa", tipo="Mensalista", horas_contratadas=40, ativo=False, coordenador=True)
    oferta = OfertaCurso(codigo_evento="X1", modalidade="Q", nome_curso="Curso X", coordenador="NOME ANTIGO DA PLANILHA")
    db_session.add_all([p1, p2, p3, oferta])
    await db_session.flush()
    try:
        await _verificar_listas(auth_client, p1)
    finally:
        # A rota de professor faz commit real no SQLite de teste: limpa para não afetar outros testes
        for obj in (p1, p2, p3, oferta):
            await db_session.delete(obj)
        await db_session.commit()


async def _verificar_listas(auth_client, p1):

    assert (await auth_client.get("/api/v1/professores/coordenadores")).json() == []

    r = await auth_client.put(f"/api/v1/professores/{p1.id}", json={"coordenador": True})
    assert r.status_code == 200 and r.json()["coordenador"] is True

    # Só ativos entram na lista de seleção
    lista = (await auth_client.get("/api/v1/professores/coordenadores")).json()
    assert [c["nome"] for c in lista] == ["Ana Coordenadora"]
    # Filtro na listagem de professores
    so_coord = (await auth_client.get("/api/v1/professores/", params={"coordenador": True})).json()
    assert {p["nome"] for p in so_coord} == {"Ana Coordenadora", "Carla Inativa"}

    # Filtros de coordenador (cronograma/ofertas): cadastrados + nomes já gravados nas ofertas
    st = (await auth_client.get("/api/v1/ofertas/stats")).json()
    assert st["coordenadores"] == ["Ana Coordenadora", "NOME ANTIGO DA PLANILHA"]

    # Desmarcar tira das listas
    await auth_client.put(f"/api/v1/professores/{p1.id}", json={"coordenador": False})
    assert (await auth_client.get("/api/v1/professores/coordenadores")).json() == []


async def test_marcacao_inicial_dos_coordenadores_antigos_uma_vez():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for nome in ("Hélia Maria de Faria", "MARCOS  MESSIAS DA CRUZ", "Outro Professor"):
            await conn.execute(text(
                "INSERT INTO professores (nome, tipo, horas_contratadas, ativo, coordenador) VALUES (:n, 'Mensalista', 40, 1, 0)"
            ), {"n": nome})

    await _seed_coordenadores(engine)
    async with engine.begin() as conn:
        marcados = {n for (n,) in await conn.execute(text("SELECT nome FROM professores WHERE coordenador = 1"))}
        assert marcados == {"Hélia Maria de Faria", "MARCOS  MESSIAS DA CRUZ"}  # ignora acento, caixa e espaços
        # Usuário desmarca um deles…
        await conn.execute(text("UPDATE professores SET coordenador = 0 WHERE nome LIKE 'Hélia%'"))

    # …e a marcação não é refeita ao reiniciar
    await _seed_coordenadores(engine)
    async with engine.begin() as conn:
        marcados = {n for (n,) in await conn.execute(text("SELECT nome FROM professores WHERE coordenador = 1"))}
        assert marcados == {"MARCOS  MESSIAS DA CRUZ"}
    await engine.dispose()
