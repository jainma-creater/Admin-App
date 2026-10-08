"""add asset links to photos for multi-photo evidence

Revision ID: e6f7a8b9c0d1
Revises: d4e5f6a7b8c9
Create Date: 2026-09-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e6f7a8b9c0d1"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {c["name"] for c in sa.inspect(conn).get_columns("photos")}
    if "asset_id" not in cols:
        op.add_column(
            "photos",
            sa.Column(
                "asset_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("visit_assets.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_photos_asset_id", "photos", ["asset_id"])
    if "it_asset_row_id" not in cols:
        op.add_column(
            "photos",
            sa.Column(
                "it_asset_row_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("visit_it_assets.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_photos_it_asset_row_id", "photos", ["it_asset_row_id"])


def downgrade() -> None:
    conn = op.get_bind()
    cols = {c["name"] for c in sa.inspect(conn).get_columns("photos")}
    if "asset_id" in cols:
        op.drop_index("ix_photos_asset_id", table_name="photos")
        op.drop_column("photos", "asset_id")
    if "it_asset_row_id" in cols:
        op.drop_index("ix_photos_it_asset_row_id", table_name="photos")
        op.drop_column("photos", "it_asset_row_id")