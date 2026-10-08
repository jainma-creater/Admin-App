"""add sample_refs to checklist_items

Revision ID: f8a9b0c1d2e3
Revises: e6f7a8b9c0d1
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f8a9b0c1d2e3"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guard: skip if the column already exists (create_all may have made it).
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='checklist_items' AND column_name='sample_refs'"
    )).first()
    if not exists:
        op.add_column(
            "checklist_items",
            sa.Column("sample_refs", postgresql.JSON(astext_type=sa.Text()), nullable=True, server_default="[]"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='checklist_items' AND column_name='sample_refs'"
    )).first()
    if exists:
        op.drop_column("checklist_items", "sample_refs")