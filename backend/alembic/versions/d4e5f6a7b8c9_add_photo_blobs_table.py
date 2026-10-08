"""add photo_blobs table for PostgreSQL bytea photo storage

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if "photo_blobs" in sa.inspect(conn).get_table_names():
        return
    op.create_table(
        "photo_blobs",
        sa.Column(
            "photo_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("photos.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("thumbnail", sa.LargeBinary(), nullable=True),
        sa.Column("mime_type", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    conn = op.get_bind()
    if "photo_blobs" in sa.inspect(conn).get_table_names():
        op.drop_table("photo_blobs")