import asyncio
import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent / "app"
sys.path.insert(0, str(APP_DIR))

from core.database import async_session, engine, Base  # noqa: E402
import models  # noqa: F401, E402  (register all models)
from utils.seed import seed  # noqa: E402


async def run() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # SEED_DEMO=false in production: seed only permissions/roles/super admin.
    include_demo = os.getenv("SEED_DEMO", "true").lower() in ("1", "true", "yes")
    async with async_session() as session:
        await seed(session, include_demo=include_demo)
        await session.commit()
    await engine.dispose()
    print(f"Seed complete (include_demo={include_demo}).")


if __name__ == "__main__":
    asyncio.run(run())