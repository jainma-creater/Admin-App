import asyncio
import sys
import os
from sqlalchemy import select, delete

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
sys.path.insert(0, "/app/app")

from core.database import async_session
from models.asset import ItAssetType, VisitItAsset

async def main():
    async with async_session() as db:
        types_to_delete = (
            await db.execute(
                select(ItAssetType).where(~ItAssetType.name.in_(["Laptop", "Mobile"]))
            )
        ).scalars().all()
        type_ids = [t.id for t in types_to_delete]
        if type_ids:
            await db.execute(delete(VisitItAsset).where(VisitItAsset.asset_type_id.in_(type_ids)))
            await db.execute(delete(ItAssetType).where(ItAssetType.id.in_(type_ids)))
            await db.commit()
            print(f"Deleted {len(types_to_delete)} IT asset types: {[t.name for t in types_to_delete]}")
        else:
            print("No extra types found")
        remaining = (await db.execute(select(ItAssetType))).scalars().all()
        for r in remaining:
            print(f"Remaining IT Asset Type: {r.name} ({r.id})")

if __name__ == "__main__":
    asyncio.run(main())
