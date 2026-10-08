"""Danger zone: wipe ALL business data and restart fresh.

Keeps only: permissions, roles, and the SUPER_ADMIN account (re-created from
settings). Everything else — users, branches, regions, areas, checklists,
visits, photos, actions, reviews, notifications, audit logs, refresh tokens —
is deleted, plus every photo object in the storage bucket.

Used by the admin console's "Vanish all data" button (api/admin_reset.py).
"""
from sqlalchemy import text  # noqa: E402

from core.config import settings  # noqa: E402

# Child-most first — though TRUNCATE CASCADE handles ordering, an explicit
# list documents what "everything" means and guards against new tables being
# forgotten (they'd survive only if never referenced here).
BUSINESS_TABLES = [
    "action_evidence",
    "corrective_actions",
    "visit_it_assets",
    "visit_assets",
    "it_asset_types",
    "employees",
    "photos",
    "photo_blobs",
    "observations",
    "visit_checklist_items",
    "visit_assignments",
    "visit_reviews",
    "visits",
    "notifications",
    "audit_logs",
    "refresh_tokens",
    "checklist_items",
    "checklist_sections",
    "checklist_templates",
    "visit_types",
    "branches",
    "areas",
    "regions",
    "users",
]


async def wipe_business_data(db) -> dict:
    """TRUNCATE all business tables in one statement (FK-safe via CASCADE),
    then re-seed permissions, roles and the super admin."""
    counts_pre = await db.execute(
        text(
            """
            SELECT
              (SELECT count(*) FROM users) AS users,
              (SELECT count(*) FROM branches) AS branches,
              (SELECT count(*) FROM visits) AS visits,
              (SELECT count(*) FROM photos) AS photos,
              (SELECT count(*) FROM checklist_templates) AS templates
            """
        )
    )
    before = dict(counts_pre.mappings().first())

    tables_sql = ", ".join(BUSINESS_TABLES)
    await db.execute(text(f"TRUNCATE TABLE {tables_sql} RESTART IDENTITY CASCADE"))

    # Re-seed the minimum: permissions, roles, super admin — NO demo data.
    from utils.seed import seed

    await seed(db, include_demo=False)

    return {"before": before}


async def wipe_storage_objects() -> int:
    """Delete every stored photo object (MinIO or local disk). Best-effort."""
    try:
        from utils.storage import wipe_all_objects

        return wipe_all_objects()
    except Exception:
        return 0
