"""add remark to visit_it_assets

Revision ID: a1b2c3d4e5f6
Revises: f8a9b0c1d2e3
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guard: skip if the column already exists (create_all may have made it).
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='visit_it_assets' AND column_name='remark'"
    )).first()
    if not exists:
        op.add_column(
            "visit_it_assets",
            sa.Column("remark", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='visit_it_assets' AND column_name='remark'"
    )).first()
    if exists:
        op.drop_column("visit_it_assets", "remark")