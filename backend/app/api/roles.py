from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission
from models.user import Role, Permission as PermissionModel
from schemas.user import RoleRead, PermissionRead

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=list[RoleRead])
async def list_roles(
    current_user=Depends(require_permission(Permission.READ_USER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Role).order_by(Role.name))
    return result.scalars().all()


@router.get("/permissions", response_model=list[PermissionRead])
async def list_permissions(
    current_user=Depends(require_permission(Permission.READ_USER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PermissionModel).order_by(PermissionModel.name))
    return result.scalars().all()


@router.get("/{role_id}", response_model=RoleRead)
async def get_role(
    role_id,
    current_user=Depends(require_permission(Permission.READ_USER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Role).options(selectinload(Role.permissions)).where(Role.id == role_id)
    )
    role = result.scalar_one_or_none()
    if not role:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Role not found")
    return role