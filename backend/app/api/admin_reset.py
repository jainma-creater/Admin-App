"""Admin self-service reset: wipe all business data with confirmation word.

POST /api/v1/admin/reset   body: {"confirm": "VANISH"}
Super-admin only. Deletes users, branches, checklists, visits, photos,
actions, reviews, notifications, audit logs and refresh tokens — then
re-seeds permissions, roles and the super admin, and clears every object
in the photo bucket.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_user, is_super_admin
from core.database import get_db
from models.user import User

router = APIRouter(prefix="/admin", tags=["admin"])


class ResetRequest(BaseModel):
    confirm: str


@router.post("/reset")
async def reset_all_data(
    payload: ResetRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only the super admin can vanish data")
    if payload.confirm.strip().upper() != "VANISH":
        raise HTTPException(status_code=400, detail='Type VANISH to confirm')

    # Import at call time so the module stays out of the request hot path.
    from utils.vanish_data import wipe_business_data, wipe_storage_objects

    result = await wipe_business_data(db)
    await db.commit()
    storage_deleted = await wipe_storage_objects()

    return {
        "message": "All data vanished. Fresh start ready.",
        "deleted_counts": result["before"],
        "storage_objects_deleted": storage_deleted,
    }
