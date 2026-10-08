"""add asset/employee/it_asset_type/visit_it_asset tables

Revision ID: c3d4e5f6a7b8
Revises: b7a1c2d4e5f6
Create Date: 2026-09-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c3d4e5f6a7b8"
down_revision = "b7a1c2d4e5f6"
branch_labels = None
depends_on = None


def _table_exists(conn, name: str) -> bool:
    return name in sa.inspect(conn).get_table_names()


def _uuid_col(**kw):
    return sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, **kw)


def _user_fk(name: str, **kw):
    return sa.Column(
        name, postgresql.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, **kw,
    )


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "visit_assets"):
        op.create_table(
            "visit_assets",
            _uuid_col(),
            sa.Column("visit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("visits.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category", sa.String(150), nullable=False),
            sa.Column("name", sa.String(255), nullable=True),
            sa.Column("code", sa.String(255), nullable=True),
            sa.Column("ocr_raw", sa.Text(), nullable=True),
            sa.Column("ocr_confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("status", sa.String(20), server_default=sa.text("'PENDING'"), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("code_photo_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("photos.id", ondelete="SET NULL"), nullable=True),
            _user_fk("created_by"),
            _user_fk("updated_by"),
            *_timestamps(),
        )
        op.create_index("ix_visit_assets_visit_id", "visit_assets", ["visit_id"])
        op.create_index("ix_visit_assets_category", "visit_assets", ["category"])

    if not _table_exists(conn, "employees"):
        op.create_table(
            "employees",
            _uuid_col(),
            sa.Column("emp_code", sa.String(50), nullable=False, unique=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("department", sa.String(150), nullable=True),
            sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id", ondelete="CASCADE"), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            _user_fk("created_by"),
            _user_fk("updated_by"),
            *_timestamps(),
        )
        op.create_index("ix_employees_emp_code", "employees", ["emp_code"])
        op.create_index("ix_employees_branch_id", "employees", ["branch_id"])

    if not _table_exists(conn, "it_asset_types"):
        op.create_table(
            "it_asset_types",
            _uuid_col(),
            sa.Column("name", sa.String(100), nullable=False, unique=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
            _user_fk("created_by"),
            _user_fk("updated_by"),
            *_timestamps(),
        )

    if not _table_exists(conn, "visit_it_assets"):
        op.create_table(
            "visit_it_assets",
            _uuid_col(),
            sa.Column("visit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("visits.id", ondelete="CASCADE"), nullable=False),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            sa.Column("asset_type_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("it_asset_types.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(20), server_default=sa.text("'PENDING'"), nullable=False),
            sa.Column("code", sa.String(255), nullable=True),
            sa.Column("ocr_raw", sa.Text(), nullable=True),
            sa.Column("ocr_confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("code_photo_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("photos.id", ondelete="SET NULL"), nullable=True),
            _user_fk("created_by"),
            _user_fk("updated_by"),
            *_timestamps(),
            sa.UniqueConstraint("visit_id", "employee_id", "asset_type_id", name="uq_visit_it_asset_employee_type"),
        )
        op.create_index("ix_visit_it_assets_visit_id", "visit_it_assets", ["visit_id"])
        op.create_index("ix_visit_it_assets_employee_id", "visit_it_assets", ["employee_id"])
        op.create_index("ix_visit_it_assets_asset_type_id", "visit_it_assets", ["asset_type_id"])


def downgrade() -> None:
    conn = op.get_bind()
    for name in ("visit_it_assets", "it_asset_types", "employees", "visit_assets"):
        if _table_exists(conn, name):
            op.drop_table(name)