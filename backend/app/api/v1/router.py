from fastapi import APIRouter
from app.api.v1 import auth, cursos, professores, eventos, aulas, importacao, dashboard, relatorios, ia, versoes, ofertas, planejamento, admin, usuarios

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(cursos.router)
api_router.include_router(professores.router)
api_router.include_router(eventos.router)
api_router.include_router(aulas.router)
api_router.include_router(importacao.router)
api_router.include_router(dashboard.router)
api_router.include_router(relatorios.router)
api_router.include_router(ia.router)
api_router.include_router(versoes.router)
api_router.include_router(ofertas.router)
api_router.include_router(planejamento.router)
api_router.include_router(admin.router)
api_router.include_router(usuarios.router)
