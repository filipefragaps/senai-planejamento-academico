from datetime import datetime
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    senha: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario_nome: str
    usuario_email: str
    perfil: str


class UsuarioCreate(BaseModel):
    nome: str
    email: EmailStr
    senha: str
    perfil: str = "coordenador"


class UsuarioUpdate(BaseModel):
    nome: str | None = None
    email: EmailStr | None = None
    perfil: str | None = None
    ativo: bool | None = None


class UsuarioOut(BaseModel):
    id: int
    nome: str
    email: str
    perfil: str
    ativo: bool
    criado_em: datetime | None = None

    model_config = {"from_attributes": True}


class AlterarSenhaRequest(BaseModel):
    senha_atual: str
    nova_senha: str


class ResetSenhaRequest(BaseModel):
    nova_senha: str
