import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from core.database import get_db
from core.password_policy import validate_password_strength
from core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from models.user import User, RefreshToken, Role
from models.org import Region, Area, Branch
from schemas.auth import (
    LoginRequest, RefreshRequest, PasswordChangeRequest, Token,
    RegisterOptions, RegisterOptionsRole, RegisterRegion, RegisterArea,
    RegisterBranch, RegisterRequest, StateOption,
)
from api.deps import get_current_user, get_current_user_allow_must_change
from utils.audit import AuditLogger, utcnow

router = APIRouter(prefix="/auth", tags=["auth"])

# Server-side sanity check on top of a light regex (schema keeps a str field to
# avoid pulling in email-validator just for one endpoint).
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

# Public self-registration: which system roles mobile users may request.
# key/label drive the mobile UI; "role" is the system RoleName assigned.
REGISTER_ROLE_OPTIONS = [
    {"key": "hr", "label": "HR", "role": "HR",
     "description": "HR branch visits: staffing, welfare and records."},
    {"key": "regional_admin", "label": "Regional Admin", "role": "REGIONAL_ADMIN",
     "description": "Oversees visits across a region."},
    {"key": "branch_ops", "label": "Branch Ops", "role": "BRANCH_MANAGER",
     "description": "Works within a single branch only."},
    {"key": "other", "label": "Other", "role": "AUDITOR",
     "description": "Field inspection / auditor account."},
]
ALLOWED_REGISTER_ROLES = [o["role"] for o in REGISTER_ROLE_OPTIONS]


@router.post("/login", response_model=Token)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == payload.email.lower().strip()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")

    user.last_login_at = utcnow()

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})

    db.add(RefreshToken(
        user_id=user.id,
        token=refresh_token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    await AuditLogger.log(db, user_id=user.id, action="LOGIN",
                          entity_type="user", entity_id=user.id, request=request)

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=Token)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    decoded = decode_token(payload.refresh_token)
    if not decoded or decoded.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    result = await db.execute(select(RefreshToken).where(
        RefreshToken.token == payload.refresh_token,
    ))
    stored = result.scalar_one_or_none()
    if stored is not None and stored.revoked:
        # Replay of an already-rotated token is a strong sign of token theft:
        # revoke every session this user holds so the stolen token dies too.
        await AuditLogger.log(
            db, user_id=stored.user_id, action="REFRESH_TOKEN_REUSE_DETECTED",
            entity_type="user", entity_id=stored.user_id,
            details={"detail": "Revoked all refresh tokens for user"},
        )
        await db.execute(
            update(RefreshToken).where(RefreshToken.user_id == stored.user_id).values(revoked=True)
        )
        # Commit *before* raising: the outside dependency rolls back on error,
        # which would otherwise discard this session-kill.
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token reuse detected")

    if not stored:
        raise HTTPException(status_code=401, detail="Refresh token revoked or unknown")

    if stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user_id = decoded.get("sub")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    stored.revoked = True

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})
    db.add(RefreshToken(
        user_id=user.id,
        token=refresh_token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout")
async def logout(
    payload: RefreshRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(RefreshToken).where(RefreshToken.token == payload.refresh_token))
    token = result.scalar_one_or_none()
    if token:
        token.revoked = True
    return {"message": "Logged out"}


@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    current_user: User = Depends(get_current_user_allow_must_change),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    strength_error = validate_password_strength(payload.new_password)
    if strength_error:
        raise HTTPException(status_code=400, detail=strength_error)

    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    # A changed password must invalidate every existing session/APK: all
    # refresh tokens for the user are revoked in one shot.
    await db.execute(
        update(RefreshToken).where(RefreshToken.user_id == current_user.id).values(revoked=True)
    )
    await AuditLogger.log(
        db, user_id=current_user.id, action="PASSWORD_CHANGED",
        entity_type="user", entity_id=current_user.id, request=request,
    )
    return {"message": "Password changed"}


@router.get("/register-options", response_model=RegisterOptions)
async def register_options(db: AsyncSession = Depends(get_db)):
    """Public metadata for the mobile Create Account form: role choices, the
    state → region → area → branch tree used for the cascading dropdowns, and
    the flat state list for state-first selection.

    Data is still protected by login + role permissions; this only exposes the
    org structure needed to self-select a scope before an account exists.
    """
    regions_result = await db.execute(
        select(Region)
        .options(selectinload(Region.areas).selectinload(Area.branches))
        .order_by(Region.name)
    )
    regions = []
    state_names: dict[str, int] = {}
    for region in regions_result.scalars().all():
        areas = []
        area_list = sorted(region.areas, key=lambda a: a.name)
        for area in area_list:
            branch_list = sorted(
                [b for b in area.branches if b.is_active], key=lambda b: b.name
            )
            areas.append(RegisterArea(
                id=area.id, name=area.name, code=area.code,
                branches=[
                    RegisterBranch(
                        id=b.id, name=b.name, code=b.code,
                        state=b.state or region.state or region.name,
                    )
                    for b in branch_list
                ],
            ))
            for b in branch_list:
                state_name = b.state or region.state or region.name
                state_names[state_name] = state_names.get(state_name, 0) + 1
        regions.append(RegisterRegion(
            id=region.id, name=region.name, code=region.code,
            state=region.state, areas=areas,
        ))
        # Regions whose name IS the state (state-regions from the employee
        # master sheet 2) still count as states even if they have no active
        # branches yet.
        if region.state or (region.areas and not area_list):
            key = region.state or region.name
            state_names.setdefault(key, 0)

    states = [
        StateOption(name=name, branch_count=count)
        for name, count in sorted(state_names.items())
    ]

    return RegisterOptions(
        roles=[RegisterOptionsRole(**o) for o in REGISTER_ROLE_OPTIONS],
        regions=regions,
        states=states,
    )


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Public self-registration.

    Creates an immediately-active user whose org scope (region/area/branch) is
    set from the chosen dropdowns, so branch-scoped roles only see their own
    branch while doing verification. Returns tokens → auto-login on the app.
    """
    email = payload.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="A valid email is required")

    strength_error = validate_password_strength(payload.password)
    if strength_error:
        raise HTTPException(status_code=400, detail=strength_error)

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    if payload.role not in ALLOWED_REGISTER_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {', '.join(ALLOWED_REGISTER_ROLES)}")

    role_result = await db.execute(select(Role).where(Role.name == payload.role))
    role = role_result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=400, detail="Role not found")

    # Resolve + validate org scope based on role.
    region_id, area_id, branch_id = payload.region_id, payload.area_id, payload.branch_id

    async def _fetch(model, id_, hint: str):
        if id_ is None:
            return None
        row = (await db.execute(select(model).where(model.id == id_))).scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail=f"{hint} not found")
        return row

    branch = await _fetch(Branch, branch_id, "Branch")
    area = await _fetch(Area, area_id, "Area")
    region = await _fetch(Region, region_id, "Region")

    if payload.role == "BRANCH_MANAGER":
        if not branch:
            raise HTTPException(status_code=400, detail="Branch is required for Branch Ops accounts")
        region = await _fetch(Region, branch.region_id, "Region") if region is None else region
        area = await _fetch(Area, branch.area_id, "Area") if area is None else area
        region_id, area_id, branch_id = region.id, area.id, branch.id
        # Guard against a mismatched selection: chosen area/branch must line up.
        if area_id and area and branch.area_id != area.id:
            raise HTTPException(status_code=400, detail="Selected branch does not belong to the selected area")
        if region_id and region and branch.region_id != region.id:
            raise HTTPException(status_code=400, detail="Selected branch does not belong to the selected region")
    elif payload.role == "REGIONAL_ADMIN":
        # State-first: the client may send only a state name (from the
        # register-options states list). It must map to a state-region the
        # employee-master import created; a region_id still wins if provided.
        state_name = (payload.state or "").strip()
        if region is None and state_name:
            region = await db.scalar(
                select(Region).where(func.lower(Region.name) == state_name.lower())
            )
            if region is None:
                raise HTTPException(status_code=400, detail=f"State '{state_name}' not recognized")
        if not region:
            raise HTTPException(status_code=400, detail="State or region is required for Regional Admin accounts")
        region_id = region.id
    else:
        # HR / AUDITOR: scope optional; if a branch is given, fill area+region from it.
        if branch:
            region_id = region.id if region else branch.region_id
            area_id = area.id if area else branch.area_id
            branch_id = branch.id
        elif area and not area_id:
            area_id = area.id
        elif region and not region_id:
            region_id = region.id

    user = User(
        email=email,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        hashed_password=get_password_hash(payload.password),
        is_active=True,
        region_id=region_id,
        area_id=area_id,
        branch_id=branch_id,
        created_by=None,
    )
    # State scope: regional admins govern whole states; branch users inherit
    # their branch's state so state-first screens pre-filter correctly.
    if payload.role == "REGIONAL_ADMIN" and payload.state and payload.state.strip():
        user.state = payload.state.strip()
    elif branch and getattr(branch, "state", None):
        user.state = branch.state
    user.roles = [role]
    db.add(user)
    await db.flush()

    await AuditLogger.log(db, user_id=user.id, action="USER_REGISTERED",
                          entity_type="user", entity_id=user.id, request=request)

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})
    db.add(RefreshToken(
        user_id=user.id,
        token=refresh_token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    return Token(access_token=access_token, refresh_token=refresh_token)