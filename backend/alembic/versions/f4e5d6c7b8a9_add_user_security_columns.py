"""add user security columns (must_change_password, last_login_at)

Revision ID: f4e5d6c7b8a9
Revises: a1b2c3d4e5f6
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f4e5d6c7b8a9"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ).bindparams(t=table, c=column)).first() is not None


def upgrade() -> None:
    if not _column_exists("users", "must_change_password"):
        op.add_column(
            "users",
            sa.Column(
                "must_change_password",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
    if not _column_exists("users", "last_login_at"):
        op.add_column(
            "users",
            sa.Column("last_login_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("users", "last_login_at"):
        op.drop_column("users", "last_login_at")
    if _column_exists("users", "must_change_password"):
        op.drop_column("users", "must_change_password")