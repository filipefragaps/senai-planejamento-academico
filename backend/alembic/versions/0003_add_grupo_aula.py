"""add grupo_aula table and column

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "grupo_aula" not in tables:
        op.create_table(
            "grupo_aula",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("criado_em", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    cols = [c["name"] for c in inspector.get_columns("aulas")]
    if "grupo_aula_id" not in cols:
        op.add_column(
            "aulas",
            sa.Column(
                "grupo_aula_id",
                sa.Integer(),
                sa.ForeignKey("grupo_aula.id", ondelete="SET NULL"),
                nullable=True,
                index=True,
            ),
        )


def downgrade() -> None:
    op.drop_column("aulas", "grupo_aula_id")
    op.drop_table("grupo_aula")
