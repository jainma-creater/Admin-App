from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission, is_super_admin, get_current_user
from models.user import User, Role
from models.org import Region, Area, Branch
from schemas.user import UserCreate, UserRead, UserUpdate, UserMinimal
from utils.audit import AuditLogger

router = APIRouter(prefix="/users", tags=["users"])


def _role_names(user: User) -> list[str]:
    return [r.name for r in user.roles]


@router.get("/me", response_model=UserRead)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_me(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).options(selectinload(User.roles)).where(User.id == current_user.id))
    user = result.scalar_one()

    data = payload.model_dump(exclude_unset=True)
    # Disallow self-escalation of roles or status
    data.pop("role_ids", None)
    data.pop("is_active", None)

    for key, value in data.items():
        setattr(user, key, value)

    user.updated_by = current_user.id
    await db.flush()
    await AuditLogger.log(db, user_id=current_user.id,
                          action="PROFILE_UPDATED", entity_type="user", entity_id=user.id)
    res = await db.execute(select(User).options(selectinload(User.roles)).where(User.id == user.id))
    return res.scalar_one()


@router.get("", response_model=list[UserRead])
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str | None = None,
    current_user: User = Depends(require_permission(Permission.READ_USER)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).options(selectinload(User.roles)).order_by(User.created_at.desc())
    if search:
        like = f"%{search}%"
        stmt = stmt.where(User.first_name.ilike(like) | User.last_name.ilike(like) | User.email.ilike(like))
    stmt = stmt.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: UUID,
    current_user: User = Depends(require_permission(Permission.READ_USER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).options(selectinload(User.roles)).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_permission(Permission.CREATE_USER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == payload.email.lower().strip()))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    from core.security import get_password_hash

    roles = []
    if payload.role_ids:
        result = await db.execute(select(Role).where(Role.id.in_(payload.role_ids)))
        roles = list(result.scalars().all())

    user = User(
        email=payload.email.strip().lower(),
        phone=payload.phone,
        first_name=payload.first_name,
        last_name=payload.last_name,
        hashed_password=get_password_hash(payload.password),
        is_active=payload.is_active,
        region_id=payload.region_id,
        area_id=payload.area_id,
        branch_id=payload.branch_id,
        created_by=current_user.id,
    )
    user.roles = roles
    db.add(user)
    await db.flush()

    await AuditLogger.log(db, user_id=current_user.id,
                          action="USER_CREATED", entity_type="user", entity_id=user.id)
    return user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: UUID,
    payload: UserUpdate,
    current_user: User = Depends(require_permission(Permission.UPDATE_USER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).options(selectinload(User.roles)).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    data = payload.model_dump(exclude_unset=True)
    role_ids = data.pop("role_ids", None)

    for key, value in data.items():
        setattr(user, key, value)

    if role_ids is not None:
        result = await db.execute(select(Role).where(Role.id.in_(role_ids)))
        user.roles = list(result.scalars().all())

    user.updated_by = current_user.id
    await AuditLogger.log(db, user_id=current_user.id,
                          action="USER_UPDATED", entity_type="user", entity_id=user.id)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    current_user: User = Depends(require_permission(Permission.DELETE_USER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user.is_active = False
    await AuditLogger.log(db, user_id=current_user.id,
                          action="USER_DEACTIVATED", entity_type="user", entity_id=user.id)


def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Super admin only")
    return current_user