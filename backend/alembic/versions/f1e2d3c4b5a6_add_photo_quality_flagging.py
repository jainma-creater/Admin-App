"""add photo status, rejection_reason, reviewed_by, reviewed_at to photos table

Revision ID: f1e2d3c4b5a6
Revises: c0d1e2f3a4b5
Create Date: 2026-10-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "f1e2d3c4b5a6"
down_revision = "c0d1e2f3a4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Check if columns already exist before adding
    existing_cols = {
        row[0]
        for row in conn.execute(
            sa.text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='photos'"
            )
        )
    }

    if "status" not in existing_cols:
        op.add_column("photos", sa.Column("status", sa.String(length=32), server_default="ACCEPTED", nullable=False))
        op.create_index("ix_photos_status", "photos", ["status"], unique=False)
    if "rejection_reason" not in existing_cols:
        op.add_column("photos", sa.Column("rejection_reason", sa.String(length=255), nullable=True))
    if "reviewed_by" not in existing_cols:
        op.add_column("photos", sa.Column("reviewed_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    if "reviewed_at" not in existing_cols:
        op.add_column("photos", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_index("ix_photos_status", table_name="photos")
    op.drop_column("photos", "reviewed_at")
    op.drop_column("photos", "reviewed_by")
    op.drop_column("photos", "rejection_reason")
    op.drop_column("photos", "status")
