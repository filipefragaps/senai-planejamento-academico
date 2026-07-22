"""Script para criar o usuário administrador inicial."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import AsyncSessionLocal, create_tables
from app.models.usuario import Usuario
from app.core.security import hash_password
from sqlalchemy import select


async def main():
    print("Criando tabelas...")
    await create_tables()

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Usuario).where(Usuario.email == "admin@senai.br"))
        existing = result.scalar_one_or_none()
        if existing:
            print("Usuário admin já existe.")
            return

        user = Usuario(
            nome="Administrador SENAI",
            email="admin@senai.br",
            hashed_password=hash_password("senai@2024"),
            perfil="admin",
            ativo=True,
        )
        db.add(user)
        await db.commit()

        print("\n✓ Banco de dados criado com sucesso!")
        print("✓ Usuário administrador criado:\n")
        print("   Email : admin@senai.br")
        print("   Senha : senai@2024\n")


if __name__ == "__main__":
    asyncio.run(main())
