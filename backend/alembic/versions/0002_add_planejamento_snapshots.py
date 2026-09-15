"""add planejamento_snapshots table

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "planejamento_snapshots" not in tables:
        op.create_table(
            "planejamento_snapshots",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column(
                "evento_id",
                sa.Integer(),
                sa.ForeignKey("eventos.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("aulas_snapshot", sa.JSON(), nullable=False),
            sa.Column("total_aulas", sa.Integer(), nullable=True, default=0),
            sa.Column("descricao", sa.String(300), nullable=True),
            sa.Column(
                "criado_em",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                index=True,
            ),
        )


def downgrade() -> None:
    op.drop_table("planejamento_snapshots")
