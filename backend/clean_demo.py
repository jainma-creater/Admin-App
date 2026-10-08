import asyncio
from sqlalchemy import select, delete
from core.database import async_session
from models.visit import Visit
from models.branch import Branch

async def clean():
    async with async_session() as db:
        await db.execute(delete(Visit).where(Visit.branch_id.in_(
            select(Branch.id).where(Branch.name.like("Demo %"))
        )))
        await db.commit()
        print("Demo visits deleted")

asyncio.run(clean())