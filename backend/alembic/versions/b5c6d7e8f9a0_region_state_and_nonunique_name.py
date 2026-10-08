"""region.state column + non-unique region name + users.state scope

The employee master workbook (sheet 2) maps regional admins to STATES.
We store each state as a Region whose name is the state name so the mobile
app's existing region_id scoping keeps working. Two different states can
share an area/cluster name (areas are unique per region, not globally), so
regions.name must no longer be unique; state grouping instead uses the new
regions.state column (set for imported state-regions) and falls back to the
state recorded on branches.

Multi-state regional admins (e.g. Shubham governs four states) cannot be
expressed by a single region_id, so users gains a comma-separated `state`
scope column that branch scoping also honours.

Revision ID: b5c6d7e8f9a0
Revises: c0d1e2f3a4b5
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa

revision = "b5c6d7e8f9a0"
down_revision = "c0d1e2f3a4b5"
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


def _index_exists(conn, table: str, index: str) -> bool:
    return conn.execute(
        sa.text(
            "SELECT 1 FROM pg_indexes WHERE tablename=:t AND indexname=:i"
        ),
        {"t": table, "i": index},
    ).first() is not None


def _drop_unique_constraint(conn, table: str, *candidates: str) -> None:
    """Drop the first candidate unique constraint that actually exists.

    The constraint name differs across environments (schema-created
    `uq_regions_name` vs. migration-created `regions_name_key`), and a failed
    DROP aborts the surrounding transaction, so existence must be checked
    first rather than relying on a try/except.
    """
    for name in candidates:
        row = conn.execute(
            sa.text(
                "SELECT 1 FROM pg_constraint "
                "WHERE conrelid = CAST(:t AS regclass) AND conname = :n AND contype = 'u'"
            ),
            {"t": table, "n": name},
        ).first()
        if row is not None:
            op.drop_constraint(name, table, type_="unique")
            return


def upgrade() -> None:
    conn = op.get_bind()

    if not _column_exists(conn, "regions", "state"):
        op.add_column("regions", sa.Column("state", sa.String(length=100), nullable=True))
    if not _index_exists(conn, "regions", "ix_regions_state"):
        op.create_index("ix_regions_state", "regions", ["state"], unique=False)

    # Name is no longer globally unique (state regions can collide with
    # pre-existing business region names from older imports).
    _drop_unique_constraint(conn, "regions", "regions_name_key", "uq_regions_name")
    if not _index_exists(conn, "regions", "ix_regions_name"):
        op.create_index("ix_regions_name", "regions", ["name"], unique=False)

    # Multi-state regional admins (employee-master sheet 2) scope by state
    # names (comma-separated) — one region_id cannot express several states.
    if not _column_exists(conn, "users", "state"):
        op.add_column("users", sa.Column("state", sa.String(length=500), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    if _column_exists(conn, "users", "state"):
        op.drop_column("users", "state")
    if _index_exists(conn, "regions", "ix_regions_name"):
        op.drop_index("ix_regions_name", table_name="regions")
        op.create_unique_constraint("uq_regions_name", "regions", ["name"])
    if _index_exists(conn, "regions", "ix_regions_state"):
        op.drop_index("ix_regions_state", table_name="regions")
    if _column_exists(conn, "regions", "state"):
        op.drop_column("regions", "state")
