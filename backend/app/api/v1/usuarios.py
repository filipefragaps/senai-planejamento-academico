from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.auth import UsuarioCreate, UsuarioOut, UsuarioUpdate, ResetSenhaRequest
from app.core.security import hash_password
from app.core.deps import require_admin, get_current_user

router = APIRouter(prefix="/usuarios", tags=["Usuários"])

PERFIS_VALIDOS = {"admin", "coordenador", "visualizador"}


@router.get("/", response_model=list[UsuarioOut])
async def listar_usuarios(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(Usuario).order_by(Usuario.nome))
    return result.scalars().all()


@router.post("/", response_model=UsuarioOut, status_code=201)
async def criar_usuario(
    data: UsuarioCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    if data.perfil not in PERFIS_VALIDOS:
        raise HTTPException(400, f"Perfil inválido. Use: {', '.join(PERFIS_VALIDOS)}")

    existing = await db.execute(select(Usuario).where(Usuario.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email já cadastrado")

    user = Usuario(
        nome=data.nome,
        email=data.email,
        hashed_password=hash_password(data.senha),
        perfil=data.perfil,
        ativo=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UsuarioOut)
async def atualizar_usuario(
    user_id: int,
    data: UsuarioUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_admin),
):
    result = await db.execute(select(Usuario).where(Usuario.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")

    if data.perfil and data.perfil not in PERFIS_VALIDOS:
        raise HTTPException(400, f"Perfil inválido. Use: {', '.join(PERFIS_VALIDOS)}")

    # Impede o admin de se auto-desativar ou trocar seu próprio perfil
    if user_id == current_user.id:
        if data.ativo is False:
            raise HTTPException(400, "Você não pode desativar sua própria conta")
        if data.perfil and data.perfil != "admin":
            raise HTTPException(400, "Você não pode alterar o próprio perfil")

    if data.email and data.email != user.email:
        dup = await db.execute(select(Usuario).where(Usuario.email == data.email))
        if dup.scalar_one_or_none():
            raise HTTPException(400, "Email já em uso por outro usuário")

    for campo, valor in data.model_dump(exclude_unset=True).items():
        setattr(user, campo, valor)

    await db.commit()
    await db.refresh(user)
    return user


@router.post("/{user_id}/reset-senha")
async def reset_senha(
    user_id: int,
    data: ResetSenhaRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(Usuario).where(Usuario.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuário não encontrado")

    if len(data.nova_senha) < 6:
        raise HTTPException(400, "A nova senha deve ter pelo menos 6 caracteres")

    user.hashed_password = hash_password(data.nova_senha)
    await db.commit()
    return {"ok": True, "mensagem": f"Senha de {user.nome} redefinida com sucesso"}
