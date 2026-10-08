"""add role_tags to checklist_items

Revision ID: b7a1c2d4e5f6
Revises: None (first migration — table management was handled by create_all)
Create Date: 2026-09-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b7a1c2d4e5f6"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guard: if the column already exists (create_all made it), skip cleanly.
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='checklist_items' AND column_name='role_tags'"
    )).first()
    if not exists:
        op.add_column(
            "checklist_items",
            sa.Column("role_tags", postgresql.JSON(astext_type=sa.Text()), nullable=True, server_default="[]"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='checklist_items' AND column_name='role_tags'"
    )).first()
    if exists:
        op.drop_column("checklist_items", "role_tags")
