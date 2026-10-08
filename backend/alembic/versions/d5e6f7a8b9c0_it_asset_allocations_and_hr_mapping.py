"""it_asset_allocations table + hr_manager_id on employees + allocation_matched on visit_it_assets

Revision ID: d5e6f7a8b9c0
Revises: b5c6d7e8f9a0, f1e2d3c4b5a6 (converges the two existing heads)
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "d5e6f7a8b9c0"
# The repo's chain had two heads (region-state and photo-quality migrations
# both branch off c0d1e2f3a4b5). This migration converges them so that
# `alembic upgrade head` has exactly one head again.
down_revision = ("f1e2d3c4b5a6", "b5c6d7e8f9a0")
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    return conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name=:t AND column_name=:c"
        ),
        {"t": table, "c": column},
    ).first() is not None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Device-allocation table (super admin assigns devices per year;
    #    regional admins verify the codes during annual visits).
    if not conn.execute(
        sa.text("SELECT 1 FROM information_schema.tables WHERE table_name='it_asset_allocations'")
    ).first():
        op.create_table(
            "it_asset_allocations",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("employee_id", UUID(as_uuid=True),
                      sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("asset_type_id", UUID(as_uuid=True),
                      sa.ForeignKey("it_asset_types.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("device_code", sa.String(length=255), nullable=False),
            sa.Column("allocation_year", sa.Integer(), nullable=False, index=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="ASSIGNED"),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("created_by", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True),
            sa.Column("updated_by", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("employee_id", "asset_type_id", "allocation_year", "device_code",
                                name="uq_it_asset_alloc_device"),
        )

    # 2. Employees.hr_manager_id (HR Manager mapping from the import file).
    if not _column_exists(conn, "employees", "hr_manager_id"):
        op.add_column(
            "employees",
            sa.Column("hr_manager_id", UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True),
        )

    # 3. visit_it_assets.allocation_matched — set during verification when the
    #    scanned code matches the super-admin allocation for the year.
    if not _column_exists(conn, "visit_it_assets", "allocation_matched"):
        op.add_column(
            "visit_it_assets",
            sa.Column("allocation_matched", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _column_exists(conn, "visit_it_assets", "allocation_matched"):
        op.drop_column("visit_it_assets", "allocation_matched")
    if _column_exists(conn, "employees", "hr_manager_id"):
        op.drop_column("employees", "hr_manager_id")
    if conn.execute(
        sa.text("SELECT 1 FROM information_schema.tables WHERE table_name='it_asset_allocations'")
    ).first():
        op.drop_table("it_asset_allocations")
