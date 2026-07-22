from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.auth import LoginRequest, TokenResponse, UsuarioCreate, UsuarioOut, AlterarSenhaRequest
from app.core.security import hash_password, verify_password, create_access_token
from app.core.deps import get_current_user, require_admin

router = APIRouter(prefix="/auth", tags=["Autenticação"])


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Usuario).where(Usuario.email == data.email, Usuario.ativo == True))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.senha, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")

    token = create_access_token({"sub": str(user.id), "perfil": user.perfil})
    return TokenResponse(
        access_token=token,
        usuario_nome=user.nome,
        usuario_email=user.email,
        perfil=user.perfil,
    )


@router.post("/registrar", response_model=UsuarioOut)
async def registrar(data: UsuarioCreate, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(Usuario).where(Usuario.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email já cadastrado")

    user = Usuario(
        nome=data.nome,
        email=data.email,
        hashed_password=hash_password(data.senha),
        perfil=data.perfil,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/me", response_model=UsuarioOut)
async def me(current_user: Usuario = Depends(get_current_user)):
    return current_user


@router.post("/alterar-senha")
async def alterar_senha(
    data: AlterarSenhaRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if not verify_password(data.senha_atual, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    if len(data.nova_senha) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter pelo menos 6 caracteres")
    current_user.hashed_password = hash_password(data.nova_senha)
    await db.commit()
    return {"ok": True, "mensagem": "Senha alterada com sucesso"}
