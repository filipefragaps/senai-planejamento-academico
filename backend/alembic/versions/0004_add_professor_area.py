"""add area column to professores

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-30
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = [c["name"] for c in inspector.get_columns("professores")]
    if "area" not in cols:
        op.add_column(
            "professores",
            sa.Column("area", sa.String(100), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("professores", "area")
