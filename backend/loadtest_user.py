"""Create/refresh a dedicated load-test user and print a fresh access token.

Run INSIDE the backend container so it uses the app's own hashing, models and
database connection:

    docker exec branch-visit-backend-1 python loadtest_user.py

Deliberately does NOT touch the super-admin account: seeding only *creates* the
admin when absent, so we never reset its password. This account exists purely
so the load harness can exercise authenticated endpoints and the photo/OCR
path. It is idempotent - safe to re-run.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))
os.environ.setdefault("AUTO_CREATE_TABLES", "false")

from sqlalchemy import select  # noqa: E402

from core.database import async_session, engine  # noqa: E402
from core.security import create_access_token, get_password_hash  # noqa: E402
from models.user import User, Role  # noqa: E402

EMAIL = os.getenv("LT_EMAIL", "loadtest@branchvisit.local")
PASSWORD = os.getenv("LT_PASSWORD", "LoadTest!2026#Branch")
# Branch Manager sees branch-scoped branch/employee/visit data, which is what
# the read mix exercises. Least privilege for a load account.
ROLE = os.getenv("LT_ROLE", "BRANCH_MANAGER")


async def main() -> int:
    async with async_session() as db:
        role = (await db.execute(select(Role).where(Role.name == ROLE))).scalar_one_or_none()
        if role is None:
            names = [r.name for r in (await db.execute(select(Role))).scalars().all()]
            print(f"ERROR: role {ROLE!r} not found. Available: {names}")
            return 1

        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one_or_none()
        if user is None:
            user = User(
                email=EMAIL,
                first_name="Load",
                last_name="Test",
                hashed_password=get_password_hash(PASSWORD),
                is_active=True,
            )
            print(f"created user {EMAIL}")
        else:
            # Keep the password known so the harness can always log in.
            user.hashed_password = get_password_hash(PASSWORD)
            user.is_active = True
            print(f"refreshed existing user {EMAIL}")
        user.roles = [role]
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id

    token = create_access_token({"sub": str(user_id), "email": EMAIL})
    await engine.dispose()

    print("ROLE=" + ROLE)
    print("EMAIL=" + EMAIL)
    print("PASSWORD=" + PASSWORD)
    print("TOKEN=" + token)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))