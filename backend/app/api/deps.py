import uuid
from typing import Optional

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.security import decode_token
from core.database import get_db
from core.permissions import has_permission, RoleName
from models.user import User

security = HTTPBearer(auto_error=False)


def _assert_password_allowed(user: User, allow_must_change: bool) -> None:
    """Block scoped users from every endpoint except the password-change flow
    until a forced password change has been completed."""
    if getattr(user, "must_change_password", False) and not allow_must_change:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "PASSWORD_CHANGE_REQUIRED", "message": "Password change required"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    _assert_password_allowed(user, allow_must_change=False)
    return user


async def get_current_user_allow_must_change(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Same as get_current_user but lets a user through to complete a forced
    password change (used by the /auth/change-password endpoint)."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


def require_permission(permission: str):
    async def checker(current_user: User = Depends(get_current_user)) -> User:
        user_role_names = {r.name for r in current_user.roles}
        if not user_role_names:
            raise HTTPException(status_code=403, detail="No roles assigned")

        allowed = False
        for role in user_role_names:
            if role == RoleName.SUPER_ADMIN or has_permission(role, permission):
                allowed = True
                break
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return current_user

    return checker


def require_permission_query(permission: str):
    """Like require_permission but resolves the token from the header OR the
    `token` query param — used by <a href> downloads that cannot set headers."""

    async def checker(current_user: User = Depends(get_current_user_query)) -> User:
        user_role_names = {r.name for r in current_user.roles}
        if not user_role_names:
            raise HTTPException(status_code=403, detail="No roles assigned")

        allowed = False
        for role in user_role_names:
            if role == RoleName.SUPER_ADMIN or has_permission(role, permission):
                allowed = True
                break
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return current_user

    return checker


def is_super_admin(user: User) -> bool:
    return any(r.name == RoleName.SUPER_ADMIN for r in user.roles)


async def get_current_user_query(
    token: Optional[str] = Query(None, description="Bearer access token passed as a query param (used by <img>/<Image> tags that can't set headers)"),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the current user from a Bearer header OR a `token` query param.

    Photo <img>/<Image> tags cannot attach Authorization headers, so the web and
    mobile clients pass `?token=<access_token>` instead. This is safe because a
    valid signed access token is required either way."""
    raw = credentials.credentials if credentials is not None else token
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(raw)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user_db = result.scalar_one_or_none()
    if user_db is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    _assert_password_allowed(user_db, allow_must_change=False)
    return user_db


def user_role_names(user: User) -> set[str]:
    return {r.name for r in user.roles}


# Roles that legitimately see EVERY branch regardless of their org mapping.
# HR is deliberately NOT here: an HR account is mapped to a branch/area/region
# (like any other scoped user), so it must only see its own branch data.
GLOBAL_SCOPE_ROLES = (RoleName.ADMIN, RoleName.HOD, RoleName.AUDITOR)


def user_state_names(user: User) -> list[str]:
    """States a user is scoped to (comma-separated `users.state` column —
    multi-state regional admins imported from the employee-master sheet 2)."""
    return [s.strip() for s in (getattr(user, "state", None) or "").split(",") if s.strip()]


def can_access_branch(user: User, branch: object) -> bool:
    """Scope check: user must belong to the same or higher org level scope."""
    if is_super_admin(user):
        return True
    roles = user_role_names(user)
    if any(r in roles for r in GLOBAL_SCOPE_ROLES):
        return True
    # Branch/Area/Region scoped users
    if user.branch_id and branch.id == user.branch_id:
        return True
    if user.area_id and branch.area_id == user.area_id:
        return True
    if user.region_id and branch.region_id == user.region_id:
        return True
    # State-scoped users (regional admin governing one or more states)
    user_states = {s.lower() for s in user_state_names(user)}
    if user_states and (getattr(branch, "state", None) or "").strip().lower() in user_states:
        return True
    return False


def branch_scope_filter(user: User, clause=None):
    """Builds a WHERE clause (as ORM expression) restricting branch access."""
    from sqlalchemy import or_

    from models.org import Branch

    if is_super_admin(user):
        return None
    roles = user_role_names(user)
    if any(r in roles for r in GLOBAL_SCOPE_ROLES):
        return None
    clauses = []
    if user.branch_id is not None:
        clauses.append(Branch.id == user.branch_id)
    if user.area_id is not None:
        clauses.append(Branch.area_id == user.area_id)
    if user.region_id is not None:
        clauses.append(Branch.region_id == user.region_id)
    user_states = user_state_names(user)
    if user_states:
        clauses.append(
            func.lower(Branch.state).in_([s.lower() for s in user_states])
        )
    if len(clauses) == 1:
        return clauses[0]
    if clauses:
        return or_(*clauses)
    # Scope-holder with no branch/area/region/state assignment: match nothing.
    #
    # This must stay a *UUID* comparison. It used to be `Branch.id == -1`,
    # which is an integer compared against a uuid column and made Postgres
    # raise `UndefinedFunctionError: operator does not exist: uuid = integer`,
    # turning /branches and /employees into HTTP 500 for such users instead of
    # an empty list. The nil UUID is type-correct and still matches no real
    # branch, and keeping it a plain BinaryExpression means every caller's
    # existing usage (including `Branch.id.in_(select(...where(scope)))`)
    # keeps working unchanged.
    return Branch.id == uuid.UUID(int=0)  # impossible match