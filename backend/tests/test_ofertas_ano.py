"""Filtro de eventos (ofertas) pelo ano de início."""
from datetime import date

from app.models.oferta import OfertaCurso


async def test_filtro_por_ano_de_inicio(auth_client, db_session):
    for codigo, inicio, sem in [("A25", date(2025, 8, 4), 2), ("B26", date(2026, 2, 9), 1),
                                ("C26", date(2026, 12, 31), 2), ("D--", None, 1)]:
        db_session.add(OfertaCurso(codigo_evento=codigo, modalidade="Q", nome_curso=f"Curso {codigo}",
                                   data_inicio=inicio, semestre=sem, vagas=10))
    await db_session.flush()

    def codigos(r):
        return sorted(o["codigo_evento"] for o in r.json())

    assert codigos(await auth_client.get("/api/v1/ofertas/", params={"ano": 2026})) == ["B26", "C26"]
    assert codigos(await auth_client.get("/api/v1/ofertas/", params={"ano": 2025})) == ["A25"]
    # Combina com o semestre
    assert codigos(await auth_client.get("/api/v1/ofertas/", params={"ano": 2026, "semestre": 2})) == ["C26"]
    # Sem ano: todos, inclusive sem data de início
    assert len((await auth_client.get("/api/v1/ofertas/")).json()) == 4

    st = (await auth_client.get("/api/v1/ofertas/stats", params={"ano": 2026})).json()
    assert st["total"] == 2 and st["vagas_total"] == 20
    assert st["anos"] == [2026, 2025]
