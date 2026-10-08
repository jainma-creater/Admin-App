"""add photo idempotency + client_idempotency table

Revision ID: c0d1e2f3a4b5
Revises: a9b8c7d6e5f4
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "c0d1e2f3a4b5"
down_revision = "a9b8c7d6e5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("photos", sa.Column("device_id", sa.String(length=255), nullable=True))
    op.add_column("photos", sa.Column("client_photo_id", sa.String(length=128), nullable=True))
    op.create_index("ix_photos_device_id", "photos", ["device_id"], unique=False)
    op.create_unique_constraint("uq_photos_device_client", "photos", ["device_id", "client_photo_id"])

    op.create_table(
        "client_idempotency",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("user_id", UUID(), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("key", "user_id", "method", "path"),
    )


def downgrade() -> None:
    op.drop_table("client_idempotency")
    op.drop_constraint("uq_photos_device_client", "photos", type_="unique")
    op.drop_index("ix_photos_device_id", table_name="photos")
    op.drop_column("photos", "client_photo_id")
    op.drop_column("photos", "device_id")