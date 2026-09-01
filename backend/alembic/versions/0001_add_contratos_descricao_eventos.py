"""add descricao and eventos to contratos_docente

Revision ID: 0001
Revises:
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # descricao já existia como String(300); troca para Text e garante nullable
    # Se a coluna não existe, adiciona. Se existe, altera.
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("contratos_docente")}

    if "descricao" not in cols:
        op.add_column("contratos_docente", sa.Column("descricao", sa.Text(), nullable=True))
    else:
        op.alter_column("contratos_docente", "descricao", type_=sa.Text(), existing_nullable=True)

    if "eventos" not in cols:
        op.add_column("contratos_docente", sa.Column("eventos", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("contratos_docente", "eventos")
    op.alter_column("contratos_docente", "descricao", type_=sa.String(300), existing_nullable=True)
