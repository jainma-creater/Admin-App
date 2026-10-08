"""Scope the load-test user to a real branch and print a usable visit + IT row.

The load account starts with no branch/area/region assignment, which (correctly)
means it sees zero branches and cannot reach any visit — so it could never
exercise the photo/OCR endpoints. This attaches it to the branch that owns a
demo visit which already has IT asset rows, then prints the ids the load
harness needs.

Idempotent; re-running is safe.

    docker exec branch-visit-backend-1 python loadtest_scope.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))
os.environ.setdefault("AUTO_CREATE_TABLES", "false")

from sqlalchemy import select  # noqa: E402

from core.database import async_session, engine  # noqa: E402
from models.user import User  # noqa: E402
from models.org import Branch  # noqa: E402
from models.visit import Visit  # noqa: E402
from models.asset import VisitItAsset  # noqa: E402

EMAIL = os.getenv("LT_EMAIL", "loadtest@branchvisit.local")


async def main() -> int:
    async with async_session() as db:
        # A visit that already has IT asset rows is the cheapest realistic
        # target for the code-plate photo/OCR endpoint.
        rows = (await db.execute(
            select(VisitItAsset.visit_id, VisitItAsset.id, Visit.branch_id)
            .join(Visit, Visit.id == VisitItAsset.visit_id)
            .limit(5)
        )).all()

        if not rows:
            print("ERROR: no visit has IT asset rows; seed IT visit data first")
            return 1

        visit_id, it_row_id, branch_id = rows[0]
        print(f"visit_id={visit_id}")
        print(f"it_row_id={it_row_id}")
        print(f"branch_id={branch_id}")

        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one_or_none()
        if user is None:
            print(f"ERROR: load user {EMAIL} does not exist - run loadtest_user.py first")
            return 1
        user.branch_id = branch_id
        db.add(user)
        await db.commit()
        branch = (await db.execute(select(Branch).where(Branch.id == branch_id))).scalar_one()
        print(f"scoped {EMAIL} -> branch {branch.name} ({branch_id})")

        total_rows = (await db.execute(select(VisitItAsset))).scalars().all()
        print(f"it_asset_rows_total={len(total_rows)}")
    await engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))