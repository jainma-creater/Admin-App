"""add user lockout columns (failed_login_attempts, locked_until)

Revision ID: g1h2i3j4k5l6
Revises: d5e6f7a8b9c0
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "g1h2i3j4k5l6"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    return conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ).bindparams(t=table, c=column)).first() is not None


def upgrade() -> None:
    if not _column_exists("users", "failed_login_attempts"):
        op.add_column(
            "users",
            sa.Column(
                "failed_login_attempts",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
    if not _column_exists("users", "locked_until"):
        op.add_column(
            "users",
            sa.Column("locked_until", postgresql.TIMESTAMP(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("users", "locked_until"):
        op.drop_column("users", "locked_until")
    if _column_exists("users", "failed_login_attempts"):
        op.drop_column("users", "failed_login_attempts")
