import csv
import io
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from openpyxl import load_workbook

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission, get_current_user, can_access_branch, branch_scope_filter
from models.org import Region, Area, Branch
from models.user import User
from models.visit import Visit
from models.action import CorrectiveAction
from schemas.org import (
    RegionCreate, RegionRead, AreaCreate, AreaRead,
    BranchCreate, BranchUpdate, BranchRead, BranchWithStats,
)
from utils.audit import AuditLogger

router = APIRouter(prefix="/branches", tags=["branches"])


# ---------- Quick add: one endpoint for Region / Area / Branch ----------

from pydantic import BaseModel  # noqa: E402
import re  # noqa: E402


class QuickAdd(BaseModel):
    type: str  # "region" | "area" | "branch"
    name: str
    region_id: UUID | None = None
    area_id: UUID | None = None
    city: str | None = None
    state: str | None = None


def _code_from_name(name: str) -> str:
    """MUMBAI -> MUM; uppercase words -> initials; fallback: first 3 alnum."""
    words = re.findall(r"[A-Za-z0-9]+", name)
    if len(words) == 1:
        return words[0][:3].upper()
    return "".join(w[0] for w in words[:3]).upper()


async def _unique_code(db: AsyncSession, base: str, kind: str) -> str:
    """Ensure code uniqueness within the table; append a number if taken."""
    if kind == "region":
        existing = (await db.execute(select(Region.code))).scalars().all()
    elif kind == "area":
        existing = (await db.execute(select(Area.code))).scalars().all()
    else:
        existing = (await db.execute(select(Branch.code))).scalars().all()
    if base not in existing:
        return base
    n = 2
    while f"{base}{n}" in existing:
        n += 1
    return f"{base}{n}"


@router.post("/quick-add", status_code=status.HTTP_201_CREATED)
async def quick_add(
    payload: QuickAdd,
    current_user=Depends(require_permission(Permission.CREATE_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    """One simple form for the admin console:
    - type=region -> just a name
    - type=area   -> name + region (region auto-created if given by name)
    - type=branch -> name + region + area (both auto-created by name if needed)
    Codes are auto-generated; GST/CIN etc. can be added later via Edit.
    """
    kind = payload.type.strip().lower()
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    if kind == "region":
        dup = await db.execute(select(Region).where(Region.name == name))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Region '{name}' already exists")
        region = Region(
            name=name,
            code=await _unique_code(db, _code_from_name(name), "region"),
            created_by=current_user.id,
        )
        db.add(region)
        await db.flush()
        await AuditLogger.log(db, user_id=current_user.id,
                              action="REGION_CREATED", entity_type="region", entity_id=region.id)
        return {"id": str(region.id), "type": "region", "name": region.name, "code": region.code}

    # Both area and branch need a region — accept id OR name (auto-create).
    region = None
    if payload.region_id:
        region = (await db.execute(select(Region).where(Region.id == payload.region_id))).scalar_one_or_none()
        if not region:
            raise HTTPException(status_code=404, detail="Region not found")

    async def _ensure_region() -> Region:
        if region:
            return region
        raise HTTPException(status_code=400, detail="Region is required")

    if kind == "area":
        if not region:
            raise HTTPException(status_code=400, detail="Region is required for an area")
        dup = await db.execute(
            select(Area).where(Area.name == name, Area.region_id == region.id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Area '{name}' already exists in {region.name}")
        area = Area(
            name=name,
            code=await _unique_code(db, _code_from_name(name), "area"),
            region_id=region.id,
            created_by=current_user.id,
        )
        db.add(area)
        await db.flush()
        await AuditLogger.log(db, user_id=current_user.id,
                              action="AREA_CREATED", entity_type="area", entity_id=area.id)
        return {"id": str(area.id), "type": "area", "name": area.name, "code": area.code}

    if kind != "branch":
        raise HTTPException(status_code=400, detail="type must be region, area or branch")

    # Branch: region required, area optional-ish (auto-created under region as "Main")
    if not region:
        raise HTTPException(status_code=400, detail="Region is required for a branch")

    area = None
    if payload.area_id:
        area = (await db.execute(select(Area).where(Area.id == payload.area_id))).scalar_one_or_none()
        if not area:
            raise HTTPException(status_code=404, detail="Area not found")
    if not area:
        # Auto-create a default area so the form stays one-step simple.
        area_name = f"{region.name} Main"
        area = (
            await db.execute(select(Area).where(Area.name == area_name, Area.region_id == region.id))
        ).scalar_one_or_none()
        if not area:
            area = Area(
                name=area_name,
                code=await _unique_code(db, _code_from_name(area_name), "area"),
                region_id=region.id,
                created_by=current_user.id,
            )
            db.add(area)
            await db.flush()

    code = await _unique_code(db, _code_from_name(name), "branch")
    branch = Branch(
        name=name,
        code=code,
        region_id=region.id,
        area_id=area.id,
        city=payload.city,
        state=payload.state,
        created_by=current_user.id,
    )
    db.add(branch)
    await db.flush()
    await AuditLogger.log(db, user_id=current_user.id,
                          action="BRANCH_CREATED", entity_type="branch", entity_id=branch.id)
    return {"id": str(branch.id), "type": "branch", "name": branch.name, "code": branch.code}


# ---------- Regions ----------

@router.get("/states", response_model=list[dict])
async def list_states(
    current_user=Depends(require_permission(Permission.READ_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    """State-first branch browsing (the field teams' mental model: "in branch
    first I see the state, in that all branches"). Returns states with their
    active branch counts, honouring the caller's branch scope. States come from
    regions whose name IS the state (regions.state set) and/or branch.state; so
    an org imported from the employee master shows every sheet-2 state."""
    from sqlalchemy import case

    branch_state = func.coalesce(Branch.state, Region.state, Region.name)
    stmt = (
        select(
            branch_state.label("state"),
            func.count(func.distinct(Branch.id)).label("branch_count"),
        )
        .outerjoin(Region, Region.id == Branch.region_id)
        .order_by(branch_state)
        .group_by(branch_state)
    )
    scope = branch_scope_filter(current_user)
    if scope is not None:
        stmt = stmt.where(scope)
    stmt = stmt.where(Branch.is_active.is_(True))
    result = await db.execute(stmt)
    return [
        {"name": s, "branch_count": int(c or 0)}
        for s, c in result.all()
        if s
    ]


@router.get("/by-state", response_model=list[BranchRead])
async def list_branches_by_state(
    state: str = Query(..., min_length=1),
    current_user=Depends(require_permission(Permission.READ_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    """All active branches of one state (scoped to the caller)."""
    from sqlalchemy import or_

    stmt = (
        select(Branch, Region.name.label("region_name"), Area.name.label("area_name"))
        .outerjoin(Region, Region.id == Branch.region_id)
        .outerjoin(Area, Area.id == Branch.area_id)
        .order_by(Branch.name)
    )
    scope = branch_scope_filter(current_user)
    if scope is not None:
        stmt = stmt.where(scope)
    stmt = stmt.where(Branch.is_active.is_(True)).where(
        or_(
            func.lower(Branch.state) == state.lower(),
            func.lower(Region.name) == state.lower(),
        )
    )
    result = await db.execute(stmt)
    out = []
    for branch, region_name, area_name in result.all():
        item = BranchRead.model_validate(branch, from_attributes=True)
        item.region_name = region_name
        item.area_name = area_name
        out.append(item)
    return out


@router.get("/regions", response_model=list[RegionRead])
async def list_regions(
    current_user=Depends(require_permission(Permission.READ_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Region).order_by(Region.name))
    return result.scalars().all()


@router.post("/regions", response_model=RegionRead, status_code=status.HTTP_201_CREATED)
async def create_region(
    payload: RegionCreate,
    current_user=Depends(require_permission(Permission.CREATE_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    region = Region(**payload.model_dump(), created_by=current_user.id)
    db.add(region)
    await db.flush()
    return region


# ---------- Areas ----------

@router.get("/areas", response_model=list[AreaRead])
async def list_areas(
    region_id: UUID | None = None,
    current_user=Depends(require_permission(Permission.READ_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Area).order_by(Area.name)
    if region_id:
        stmt = stmt.where(Area.region_id == region_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/areas", response_model=AreaRead, status_code=status.HTTP_201_CREATED)
async def create_area(
    payload: AreaCreate,
    current_user=Depends(require_permission(Permission.CREATE_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    area = Area(**payload.model_dump(), created_by=current_user.id)
    db.add(area)
    await db.flush()
    return area


# ---------- Branches ----------

@router.get("", response_model=list[BranchRead])
async def list_branches(
    region_id: UUID | None = None,
    area_id: UUID | None = None,
    region: str | None = None,
    area: str | None = None,
    search: str | None = None,
    current_user=Depends(require_permission(Permission.READ_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    # Region/area names resolved via join so the admin grid can show them
    # (and filter/sort on them) without N+1 lookups per row.
    stmt = (
        select(Branch, Region.name.label("region_name"), Area.name.label("area_name"))
        .outerjoin(Region, Region.id == Branch.region_id)
        .outerjoin(Area, Area.id == Branch.area_id)
        .order_by(Branch.name)
    )
    scope = branch_scope_filter(current_user)
    if scope is not None:
        stmt = stmt.where(scope)
    if region_id:
        stmt = stmt.where(Branch.region_id == region_id)
    if area_id:
        stmt = stmt.where(Branch.area_id == area_id)
    # Name-based filters: the dashboard KPI tiles link here with the region
    # NAME (they only know display names, not UUIDs).
    if region:
        stmt = stmt.where(Region.name == region)
    if area:
        stmt = stmt.where(Area.name == area)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(Branch.name.ilike(like) | Branch.code.ilike(like))
    result = await db.execute(stmt)
    out = []
    for branch, region_name, area_name in result.all():
        item = BranchRead.model_validate(branch, from_attributes=True)
        item.region_name = region_name
        item.area_name = area_name
        out.append(item)
    return out


@router.get("/{branch_id}", response_model=BranchWithStats)
async def get_branch(
    branch_id: UUID,
    current_user=Depends(require_permission(Permission.READ_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    branch = result.scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    if not can_access_branch(current_user, branch):
        raise HTTPException(status_code=403, detail="Access denied to this branch")

    visits_result = await db.execute(
        select(func.count(Visit.id)).where(Visit.branch_id == branch_id)
    )
    total_visits = visits_result.scalar() or 0

    avg_result = await db.execute(
        select(func.avg(Visit.compliance_percentage)).where(
            Visit.branch_id == branch_id,
            Visit.compliance_percentage.isnot(None),
        )
    )
    avg_compliance = avg_result.scalar() or 0.0

    open_result = await db.execute(
        select(func.count(CorrectiveAction.id)).where(
            CorrectiveAction.visit_id == Visit.id,
            Visit.branch_id == branch_id,
            CorrectiveAction.status.in_(["OPEN", "IN_PROGRESS"]),
        )
    )
    open_actions = open_result.scalar() or 0

    overdue_result = await db.execute(
        select(func.count(CorrectiveAction.id)).where(
            CorrectiveAction.visit_id == Visit.id,
            Visit.branch_id == branch_id,
            CorrectiveAction.status.in_(["OPEN", "IN_PROGRESS", "VERIFICATION_PENDING"]),
            CorrectiveAction.target_date < func.current_date(),
        )
    )
    overdue_actions = overdue_result.scalar() or 0

    data = BranchWithStats.model_validate(branch, from_attributes=True)
    data.total_visits = total_visits
    data.average_compliance = round(float(avg_compliance), 1)
    data.open_actions = open_actions
    data.overdue_actions = overdue_actions
    return data


@router.post("", response_model=BranchRead, status_code=status.HTTP_201_CREATED)
async def create_branch(
    payload: BranchCreate,
    current_user=Depends(require_permission(Permission.CREATE_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()
    branch = Branch(**data, created_by=current_user.id)
    db.add(branch)
    await db.flush()
    await AuditLogger.log(db, user_id=current_user.id,
                          action="BRANCH_CREATED", entity_type="branch", entity_id=branch.id)
    return branch


@router.patch("/{branch_id}", response_model=BranchRead)
async def update_branch(
    branch_id: UUID,
    payload: BranchUpdate,
    current_user=Depends(require_permission(Permission.UPDATE_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    branch = result.scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    if not can_access_branch(current_user, branch):
        raise HTTPException(status_code=403, detail="Access denied to this branch")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(branch, key, value)
    branch.updated_by = current_user.id
    await AuditLogger.log(db, user_id=current_user.id,
                          action="BRANCH_UPDATED", entity_type="branch", entity_id=branch.id)
    return branch


# --------------------------------------------------------------------------
# Excel/CSV Import for Branches (Physical Active Branches Master)
# --------------------------------------------------------------------------

_BRANCH_CODE_KEYS = {"branch code", "branchcode", "code"}
_BRANCH_NAME_KEYS = {"branch name", "branchname", "name", "branch"}
_BRANCH_CITY_KEYS = {"city", "branch city", "city name"}
_BRANCH_STATE_KEYS = {"state", "branch state", "state name"}
_BRANCH_REGION_KEYS = {"region", "region name"}
_BRANCH_AREA_KEYS = {"area", "area name", "cluster", "cluster name"}
_BRANCH_PINCODE_KEYS = {"pincode", "pin code", "pin", "zip", "zip code"}
_BRANCH_ADDRESS_KEYS = {"address", "branch address", "location address", "location", "office address", "address line 1", "address line 2"}
_BRANCH_GST_KEYS = {"gst", "gst number", "gstin", "gst no"}
_BRANCH_STATUS_KEYS = {"status", "branch status", "is active", "active"}


def _cell_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _tuples_from_spreadsheet(data: bytes, filename: str) -> list[list[str]]:
    if filename.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        return [[_cell_text(c) for c in row] for row in csv.reader(io.StringIO(text))]
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active
    rows = [[_cell_text(c) for c in r] for r in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def _rows_from_tuples(grid: list[list[str]]) -> list[dict]:
    if not grid:
        return []
    header = [h.lower() for h in grid[0]]

    code_idx = next((i for i, h in enumerate(header) if h in _BRANCH_CODE_KEYS), None)
    name_idx = next((i for i, h in enumerate(header) if h in _BRANCH_NAME_KEYS), None)
    city_idx = next((i for i, h in enumerate(header) if h in _BRANCH_CITY_KEYS), None)
    state_idx = next((i for i, h in enumerate(header) if h in _BRANCH_STATE_KEYS), None)
    region_idx = next((i for i, h in enumerate(header) if h in _BRANCH_REGION_KEYS), None)
    area_idx = next((i for i, h in enumerate(header) if h in _BRANCH_AREA_KEYS), None)
    pincode_idx = next((i for i, h in enumerate(header) if h in _BRANCH_PINCODE_KEYS), None)
    address_idx = next((i for i, h in enumerate(header) if h in _BRANCH_ADDRESS_KEYS), None)
    gst_idx = next((i for i, h in enumerate(header) if h in _BRANCH_GST_KEYS), None)
    status_idx = next((i for i, h in enumerate(header) if h in _BRANCH_STATUS_KEYS), None)

    # Fallback to positional if no headers match
    if code_idx is None and name_idx is None and region_idx is None:
        code_idx, name_idx, city_idx, state_idx = 0, 1, 2, 3
        region_idx, area_idx = 4, 5

    def at(idx: int | None, raw: list[str]) -> str:
        return raw[idx] if idx is not None and idx < len(raw) else ""

    def at_status(idx: int | None, raw: list[str]) -> bool:
        val = at(idx, raw).strip().lower()
        if not val:
            return True
        return val in ("active", "true", "1", "yes", "y", "on")

    rows = []
    for raw in grid[1:]:
        if not any(raw):
            continue
        rows.append({
            "code": at(code_idx, raw),
            "name": at(name_idx, raw),
            "city": at(city_idx, raw),
            "state": at(state_idx, raw),
            "region": at(region_idx, raw),
            "area": at(area_idx, raw),
            "pincode": at(pincode_idx, raw),
            "address": at(address_idx, raw),
            "gst_number": at(gst_idx, raw),
            "is_active": at_status(status_idx, raw),
        })
    return rows


class _BranchOrgBuilder:
    """Creates Region → Area chain from the file's hierarchy columns,
    reusing anything already in the database."""

    def __init__(self, db: AsyncSession, created_by: UUID):
        self.db = db
        self.created_by = created_by
        self.regions: dict[str, Region] = {}
        self.areas: dict[tuple, Area] = {}

    async def load(self):
        for r in (await self.db.execute(select(Region))).scalars().all():
            self.regions.setdefault(r.name.strip().lower(), r)
        for a in (await self.db.execute(select(Area))).scalars().all():
            self.areas.setdefault((str(a.region_id), a.name.strip().lower()), a)

    async def ensure(self, region_name: str, area_name: str) -> tuple[Region, Area]:
        region_name = region_name.strip()
        area_name = area_name.strip()
        if not region_name:
            region_name = "Unassigned"
        if not area_name:
            area_name = f"{region_name} Main"

        region = self.regions.get(region_name.lower())
        if not region:
            region = Region(
                name=region_name,
                code=await _unique_code(self.db, _code_from_name(region_name), "region"),
                created_by=self.created_by,
            )
            self.db.add(region)
            await self.db.flush()
            self.regions[region_name.lower()] = region

        area = self.areas.get((str(region.id), area_name.lower()))
        if not area:
            area = Area(
                name=area_name,
                code=await _unique_code(self.db, _code_from_name(area_name), "area"),
                region_id=region.id,
                created_by=self.created_by,
            )
            self.db.add(area)
            await self.db.flush()
            self.areas[(str(region.id), area_name.lower())] = area
        return region, area


class BranchImportResult(BaseModel):
    total_rows: int
    created: int
    updated: int
    skipped: int
    errors: list[str]


@router.post("/import", response_model=BranchImportResult)
async def import_branches(
    file: UploadFile = File(...),
    current_user=Depends(require_permission(Permission.CREATE_BRANCH)),
    db: AsyncSession = Depends(get_db),
):
    """Import branches from Excel (.xlsx) or CSV file.
    
    Expected columns (case-insensitive, flexible names):
    - Branch Code / Code
    - Branch Name / Name (required)
    - City
    - State
    - Region / Region Name
    - Area / Area Name / Cluster
    - Pincode / Pin Code
    - Address / Branch Address
    - GST Number / GSTIN
    - Status / Active (true/false/active/inactive)
    """
    import csv
    import io
    from openpyxl import load_workbook

    filename = file.filename or "upload.xlsx"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    grid = _tuples_from_spreadsheet(data, filename)
    rows = _rows_from_tuples(grid)

    if not rows:
        raise HTTPException(status_code=400, detail="No valid data rows found in file")

    # Auto-create Region/Area hierarchy
    builder = _BranchOrgBuilder(db, current_user.id)
    await builder.load()

    created = 0
    updated = 0
    skipped = 0
    errors: list[str] = []

    for i, row in enumerate(rows, start=2):  # start=2 (1=header)
        name = row.get("name", "").strip()
        code = row.get("code", "").strip()

        if not name:
            errors.append(f"Row {i}: Branch name is required")
            skipped += 1
            continue

        # Resolve region/area
        region_name = row.get("region", "").strip() or "Unassigned"
        area_name = row.get("area", "").strip() or f"{region_name} Main"
        region, area = await builder.ensure(region_name, area_name)

        # Generate code if not provided
        if not code:
            code = await _unique_code(db, _code_from_name(name), "branch")

        # Check for existing branch by code or name
        existing = await db.execute(
            select(Branch).where((Branch.code == code) | (Branch.name == name))
        )
        existing_branch = existing.scalar_one_or_none()

        branch_data = {
            "name": name,
            "code": code,
            "region_id": region.id,
            "area_id": area.id,
            "city": row.get("city", "").strip() or None,
            "state": row.get("state", "").strip() or None,
            "pincode": row.get("pincode", "").strip() or None,
            "address": row.get("address", "").strip() or None,
            "gst_number": row.get("gst_number", "").strip() or None,
            "is_active": row.get("is_active", True),
        }

        if existing_branch:
            for key, value in branch_data.items():
                setattr(existing_branch, key, value)
            existing_branch.updated_by = current_user.id
            updated += 1
        else:
            branch = Branch(**branch_data, created_by=current_user.id)
            db.add(branch)
            created += 1

    await db.flush()
    await AuditLogger.log(db, user_id=current_user.id,
                          action="BRANCH_IMPORT", entity_type="branch",
                          details={"created": created, "updated": updated, "skipped": skipped})

    return BranchImportResult(
        total_rows=len(rows),
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
    )