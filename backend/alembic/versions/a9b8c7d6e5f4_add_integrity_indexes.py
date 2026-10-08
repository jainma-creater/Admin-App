"""add integrity indexes (refresh revoke, audit retention, notification inbox)

Revision ID: a9b8c7d6e5f4
Revises: f4e5d6c7b8a9
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa

revision = "a9b8c7d6e5f4"
down_revision = "f4e5d6c7b8a9"
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_refresh_tokens_user_id_revoked", "refresh_tokens", ["user_id", "revoked"]),
    ("ix_audit_logs_created_at", "audit_logs", ["created_at"]),
    ("ix_notifications_user_id_read", "notifications", ["user_id", "is_read"]),
]


def _index_exists(name: str) -> bool:
    conn = op.get_bind()
    return conn.execute(
        sa.text("SELECT 1 FROM pg_indexes WHERE indexname = :n").bindparams(n=name)
    ).first() is not None


def upgrade() -> None:
    for name, table, columns in INDEXES:
        if not _index_exists(name):
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, _table, _columns in reversed(INDEXES):
        if _index_exists(name):
            op.drop_index(name)