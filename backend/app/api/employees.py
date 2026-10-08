import csv
import io
import re
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from openpyxl import Workbook, load_workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from core.security import get_password_hash

from core.database import get_db
from core.permissions import RoleName
from api.branches import _code_from_name, _unique_code
from api.deps import (
    branch_scope_filter,
    can_access_branch,
    get_current_user,
    get_current_user_query,
    is_super_admin,
)
from models.asset import Employee, ItAssetType, VisitItAsset
from models.org import Area, Branch, Region
from models.photo import Photo
from models.visit import Visit
from models.user import Role, User
from api.photos import store_visit_photo
from models.asset import ItAssetAllocation
from schemas.employee import (
    EmployeeCreate,
    EmployeeDetail,
    EmployeeAssetItem,
    EmployeeAssetPhotoRef,
    EmployeeAssetUpdatePayload,
    EmployeeAssetCreatePayload,
    EmployeeImportResult,
    EmployeeRead,
    EmployeeUpdate,
    ItAssetTypeCreate,
    ItAssetTypeRead,
    ItAssetTypeUpdate,
    ItAssetAllocationCreate,
    ItAssetAllocationUpdate,
    ItAssetAllocationRead,
    ItAssetAllocationList,
)

router = APIRouter(tags=["employees"])


def can_manage_employees(user: User) -> bool:
    if is_super_admin(user):
        return True
    return any(
        r.name in (RoleName.ADMIN, RoleName.HOD, RoleName.REGIONAL_ADMIN)
        for r in user.roles
    )


async def _branch_in_scope(db: AsyncSession, user: User, branch_id: UUID) -> Branch | None:
    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    branch = result.scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    if not can_access_branch(user, branch):
        raise HTTPException(status_code=403, detail="Access denied")
    return branch


# --------------------------------------------------------------------------
# Employee master
# --------------------------------------------------------------------------
@router.get("/employees", response_model=list[EmployeeRead])
async def list_employees(
    q: str | None = Query(None, description="Search by name or employee code"),
    branch_id: UUID | None = None,
    department: str | None = None,
    state: str | None = Query(None, description="Filter by state (branch state or state-region name)"),
    include_inactive: bool = False,
    limit: int = Query(300, ge=1, le=20000),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    staff = select(Employee.id)
    scope = branch_scope_filter(current_user)
    if scope is not None:
        staff = staff.where(Employee.branch_id.in_(select(Branch.id).where(scope)))
    sub = staff.subquery()

    stmt = (
        select(Employee, Branch.name.label("branch_name"), Branch.state.label("state"))
        .outerjoin(Branch, Branch.id == Employee.branch_id)
        .where(Employee.id.in_(select(sub.c.id)))
        .order_by(Branch.name, Employee.name)
        .limit(limit)
    )
    if q:
        needle = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(Employee.name).like(needle) | func.lower(Employee.emp_code).like(needle)
        )
    if branch_id:
        stmt = stmt.where(Employee.branch_id == branch_id)
    if department:
        stmt = stmt.where(func.lower(Employee.department) == department.strip().lower())
    # State-first browsing: filter employees by their branch's state (or the
    # state-region name their branch lives under).
    if state:
        stmt = stmt.where(
            func.lower(func.coalesce(Branch.state, "")) == state.strip().lower()
            | func.lower(func.coalesce(Region.name, "")) == state.strip().lower()
        )
        stmt = stmt.outerjoin(Region, Region.id == Branch.region_id)
    if not include_inactive:
        stmt = stmt.where(Employee.is_active.is_(True))

    # Expected asset types = ACTIVE types only (the detail endpoint shows one
    # row per active type). Rows repeat per visit (8 visits x 2 types = 16),
    # so: total = number of active types, verified = number of types with at
    # least one recorded code across ALL the employee's visit rows.
    active_type_ids = select(ItAssetType.id).where(ItAssetType.is_active.is_(True))
    total_assets = (
        select(func.count(ItAssetType.id))
        .where(ItAssetType.id.in_(active_type_ids))
        .correlate(Employee)
        .scalar_subquery()
    )
    verified_assets = (
        select(func.count(func.distinct(VisitItAsset.asset_type_id)))
        .where(
            VisitItAsset.employee_id == Employee.id,
            VisitItAsset.asset_type_id.in_(active_type_ids),
            VisitItAsset.code.isnot(None),
            VisitItAsset.code != "",
        )
        .correlate(Employee)
        .scalar_subquery()
    )
    stmt = stmt.add_columns(total_assets.label("total_assets"), verified_assets.label("verified_count"))

    result = await db.execute(stmt)
    out = []
    for emp, branch_name, state, ta, vc in result.all():
        item = EmployeeRead.model_validate(emp, from_attributes=True)
        item.branch_name = branch_name
        item.state = state
        item.hr_manager_name = emp.hr_manager.full_name if emp.hr_manager else None
        item.total_assets = int(ta or 0)
        item.verified_count = int(vc or 0)
        out.append(item)
    return out


@router.post("/employees", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee master")
    await _branch_in_scope(db, current_user, payload.branch_id)
    duplicate = await db.scalar(select(Employee).where(func.lower(Employee.emp_code) == payload.emp_code.strip().lower()))
    if duplicate:
        raise HTTPException(status_code=409, detail=f"Employee code {payload.emp_code} already exists")

    emp = Employee(
        emp_code=payload.emp_code.strip(),
        name=payload.name.strip(),
        department=payload.department.strip() if payload.department else None,
        branch_id=payload.branch_id,
        created_by=current_user.id,
    )
    db.add(emp)
    await db.flush()
    branch = await db.get(Branch, emp.branch_id)
    item = EmployeeRead.model_validate(emp, from_attributes=True)
    item.branch_name = branch.name if branch else None
    item.state = branch.state if branch else None
    item.hr_manager_name = emp.hr_manager.full_name if emp.hr_manager else None
    return item


@router.patch("/employees/{employee_id}", response_model=EmployeeRead)
async def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee master")
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if payload.branch_id is not None and payload.branch_id != emp.branch_id:
        await _branch_in_scope(db, current_user, payload.branch_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None or field == "is_active":
            setattr(emp, field, value.strip() if isinstance(value, str) else value)
    await db.flush()

    branch = await db.get(Branch, emp.branch_id)
    item = EmployeeRead.model_validate(emp, from_attributes=True)
    item.branch_name = branch.name if branch else None
    item.state = branch.state if branch else None
    item.hr_manager_name = emp.hr_manager.full_name if emp.hr_manager else None
    return item


async def _load_employee_assets_list(db: AsyncSession, emp: Employee) -> list[EmployeeAssetItem]:
    # 1. Fetch active asset types
    types = (
        await db.execute(
            select(ItAssetType).order_by(ItAssetType.sort_order, ItAssetType.name)
        )
    ).scalars().all()
    type_map = {t.id: t for t in types}

    # 2. Fetch all VisitItAsset records for this employee across ALL visits
    #    (a branch can have several parallel visits — one inspector's scan must
    #    never be hidden because another visit row sorts newer).
    stmt = (
        select(VisitItAsset)
        .options(
            selectinload(VisitItAsset.asset_type),
            selectinload(VisitItAsset.visit).selectinload(Visit.branch),
        )
        .where(VisitItAsset.employee_id == emp.id)
        .order_by(VisitItAsset.updated_at.desc(), VisitItAsset.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()

    # Resolve user names for created_by
    creator_ids = {r.created_by for r in rows if r.created_by}
    user_names: dict = {}
    if creator_ids:
        ures = await db.execute(select(User).where(User.id.in_(creator_ids)))
        user_names = {u.id: u.full_name for u in ures.scalars().all()}

    # 3. Load photos for these rows
    row_ids = [r.id for r in rows]
    photos_by_row: dict[UUID, list[Photo]] = {}
    if row_ids:
        photo_stmt = (
            select(Photo)
            .where(Photo.it_asset_row_id.in_(row_ids))
            .order_by(Photo.created_at.desc())
        )
        for p in (await db.execute(photo_stmt)).scalars().all():
            photos_by_row.setdefault(p.it_asset_row_id, []).append(p)

    # 4. Group rows by asset_type_id
    rows_by_type: dict[UUID, list[VisitItAsset]] = {}
    for r in rows:
        rows_by_type.setdefault(r.asset_type_id, []).append(r)

    items: list[EmployeeAssetItem] = []

    def _rank(r: VisitItAsset):
        """Best-evidence-first ordering: rows with a code or photos win, then most
        recently updated. Keeps parallel-visit data visible instead of burying it
        under an empty row that merely sorted newer."""
        has_evidence = 1 if (r.code or r.code_photo_id) else 0
        return (has_evidence, r.updated_at or r.created_at)

    for t in types:
        matched_rows = sorted(
            rows_by_type.get(t.id, []), key=_rank, reverse=True
        )
        if matched_rows:
            primary = matched_rows[0]
            row_photos = photos_by_row.get(primary.id, [])
            # Evidence from OTHER parallel visits must stay visible: merge the
            # primary row's photos with photos/code snapshots of the remaining
            # duplicate rows (same employee + type, different visit).
            extra_photos: list[Photo] = []
            for other in matched_rows[1:]:
                extra_photos.extend(photos_by_row.get(other.id, []))
            row_photos = row_photos + extra_photos
            photo_refs = [
                EmployeeAssetPhotoRef(
                    id=p.id,
                    photo_url=f"/api/v1/photos/{p.id}/file",
                    photo_thumbnail_url=f"/api/v1/photos/{p.id}/thumbnail",
                    captured_at=p.captured_at or p.created_at,
                )
                for p in row_photos
            ]
            # Code/OCR evidence: fill any gap from the best duplicate row
            # (another inspector may have scanned the code in a parallel
            # visit). Code and photo fall back independently.
            code = primary.code
            status = primary.status or "PENDING"
            ocr_raw = primary.ocr_raw
            ocr_confirmed = primary.ocr_confirmed
            remark = primary.remark
            code_photo_id = primary.code_photo_id
            for other in matched_rows[1:]:
                if not code and other.code:
                    code = other.code
                    if status in (None, "PENDING"):
                        status = other.status or "PENDING"
                    if not ocr_raw:
                        ocr_raw = other.ocr_raw
                    if not ocr_confirmed:
                        ocr_confirmed = other.ocr_confirmed
                    if not remark:
                        remark = other.remark
                if not code_photo_id and other.code_photo_id:
                    code_photo_id = other.code_photo_id
                if code and code_photo_id:
                    break
            primary_photo_id = code_photo_id or (row_photos[0].id if row_photos else None)
            photo_refs = [
                EmployeeAssetPhotoRef(
                    id=p.id,
                    photo_url=f"/api/v1/photos/{p.id}/file",
                    photo_thumbnail_url=f"/api/v1/photos/{p.id}/thumbnail",
                    captured_at=p.captured_at or p.created_at,
                )
                for p in row_photos
            ]
            items.append(
                EmployeeAssetItem(
                    id=primary.id,
                    asset_type_id=t.id,
                    asset_type_name=t.name,
                    code=code,
                    status=status,
                    ocr_raw=ocr_raw,
                    ocr_confirmed=ocr_confirmed,
                    remark=remark,
                    visit_id=primary.visit_id,
                    visit_branch_name=primary.visit.branch.name if primary.visit and primary.visit.branch else None,
                    verified_by_name=user_names.get(primary.created_by),
                    verified_at=primary.updated_at or primary.created_at,
                    code_photo_id=primary_photo_id,
                    photo_url=f"/api/v1/photos/{primary_photo_id}/file" if primary_photo_id else None,
                    photo_thumbnail_url=f"/api/v1/photos/{primary_photo_id}/thumbnail" if primary_photo_id else None,
                    photos=photo_refs,
                )
            )
        else:
            items.append(
                EmployeeAssetItem(
                    id=None,
                    asset_type_id=t.id,
                    asset_type_name=t.name,
                    code=None,
                    status="PENDING",
                    ocr_raw=None,
                    ocr_confirmed=False,
                    remark=None,
                    visit_id=None,
                    visit_branch_name=None,
                    verified_by_name=None,
                    verified_at=None,
                    code_photo_id=None,
                    photo_url=None,
                    photo_thumbnail_url=None,
                    photos=[],
                )
            )

    for tid, matched_rows in rows_by_type.items():
        if tid not in type_map and matched_rows:
            matched_rows = sorted(matched_rows, key=_rank, reverse=True)
            primary = matched_rows[0]
            row_photos = photos_by_row.get(primary.id, [])
            for other in matched_rows[1:]:
                row_photos.extend(photos_by_row.get(other.id, []))
            photo_refs = [
                EmployeeAssetPhotoRef(
                    id=p.id,
                    photo_url=f"/api/v1/photos/{p.id}/file",
                    photo_thumbnail_url=f"/api/v1/photos/{p.id}/thumbnail",
                    captured_at=p.captured_at or p.created_at,
                )
                for p in row_photos
            ]
            primary_photo_id = primary.code_photo_id or (row_photos[0].id if row_photos else None)
            items.append(
                EmployeeAssetItem(
                    id=primary.id,
                    asset_type_id=primary.asset_type_id,
                    asset_type_name=primary.asset_type.name if primary.asset_type else "Asset",
                    code=primary.code,
                    status=primary.status or "PENDING",
                    ocr_raw=primary.ocr_raw,
                    ocr_confirmed=primary.ocr_confirmed,
                    remark=primary.remark,
                    visit_id=primary.visit_id,
                    visit_branch_name=primary.visit.branch.name if primary.visit and primary.visit.branch else None,
                    verified_by_name=user_names.get(primary.created_by),
                    verified_at=primary.updated_at or primary.created_at,
                    code_photo_id=primary_photo_id,
                    photo_url=f"/api/v1/photos/{primary_photo_id}/file" if primary_photo_id else None,
                    photo_thumbnail_url=f"/api/v1/photos/{primary_photo_id}/thumbnail" if primary_photo_id else None,
                    photos=photo_refs,
                )
            )

    return items


# NOTE: static routes must be declared BEFORE /employees/{employee_id} —
# FastAPI matches in declaration order and "template" would otherwise be
# parsed as a UUID (401/422 instead of serving the xlsx download).
@router.get("/employees/template")
async def employee_template(
    current_user=Depends(get_current_user_query),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee master")
    wb = Workbook()
    ws = wb.active
    ws.title = "Employees"
    ws.append(["Emp Code", "Emp Name", "Department", "Branch"])
    ws.append(["EMP001", "Rahul Sharma", "Operations", "Demo Mumbai Andheri"])
    ws.append(["EMP002", "Priya Patel", "Customer Service", "Demo Mumbai Borivali"])
    for col, width in zip("ABCD", (14, 28, 22, 28)):
        ws.column_dimensions[col].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="employees_template.xlsx"'},
    )


@router.get("/employees/{employee_id}", response_model=EmployeeDetail)
async def get_employee_detail(
    employee_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    await _branch_in_scope(db, current_user, emp.branch_id)
    branch = await db.get(Branch, emp.branch_id)
    assets_list = await _load_employee_assets_list(db, emp)

    verified_count = sum(1 for a in assets_list if a.status == "VERIFIED" or (a.code and a.code.strip()))
    total_assets = len(assets_list)

    item = EmployeeDetail.model_validate(emp, from_attributes=True)
    item.branch_name = branch.name if branch else None
    item.state = branch.state if branch else None
    item.hr_manager_name = emp.hr_manager.full_name if emp.hr_manager else None
    item.verified_count = verified_count
    item.total_assets = total_assets
    item.assets = assets_list
    return item


@router.get("/employees/{employee_id}/assets", response_model=list[EmployeeAssetItem])
async def get_employee_assets(
    employee_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    await _branch_in_scope(db, current_user, emp.branch_id)
    return await _load_employee_assets_list(db, emp)


@router.patch("/employees/{employee_id}/assets/{asset_row_id}", response_model=EmployeeAssetItem)
async def update_employee_asset(
    employee_id: UUID,
    asset_row_id: UUID,
    payload: EmployeeAssetUpdatePayload,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee assets")
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    await _branch_in_scope(db, current_user, emp.branch_id)

    row = await db.get(VisitItAsset, asset_row_id)
    if not row or row.employee_id != emp.id:
        raise HTTPException(status_code=404, detail="Asset record not found")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    if data.get("code") and not row.status:
        row.status = "VERIFIED"

    await db.flush()
    assets = await _load_employee_assets_list(db, emp)
    for a in assets:
        if a.id == row.id:
            return a
    raise HTTPException(status_code=404, detail="Updated asset not found")


@router.post("/employees/{employee_id}/assets", response_model=EmployeeAssetItem, status_code=status.HTTP_201_CREATED)
async def create_or_assign_employee_asset(
    employee_id: UUID,
    payload: EmployeeAssetCreatePayload,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee assets")
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    await _branch_in_scope(db, current_user, emp.branch_id)

    # Check or find latest visit for this branch
    visit = await db.scalar(
        select(Visit)
        .where(Visit.branch_id == emp.branch_id)
        .order_by(Visit.created_at.desc())
    )
    if not visit:
        # Create a container visit for asset records
        visit = Visit(
            branch_id=emp.branch_id,
            status="DRAFT",
            created_by=current_user.id,
        )
        db.add(visit)
        await db.flush()

    # Check if a row already exists for (visit.id, emp.id, asset_type_id)
    row = await db.scalar(
        select(VisitItAsset).where(
            VisitItAsset.visit_id == visit.id,
            VisitItAsset.employee_id == emp.id,
            VisitItAsset.asset_type_id == payload.asset_type_id,
        )
    )
    if not row:
        row = VisitItAsset(
            visit_id=visit.id,
            employee_id=emp.id,
            asset_type_id=payload.asset_type_id,
            code=payload.code,
            status=payload.status or "VERIFIED",
            remark=payload.remark,
            created_by=current_user.id,
        )
        db.add(row)
    else:
        if payload.code is not None:
            row.code = payload.code
        if payload.status is not None:
            row.status = payload.status
        if payload.remark is not None:
            row.remark = payload.remark
    await db.flush()

    assets = await _load_employee_assets_list(db, emp)
    for a in assets:
        if a.id == row.id or (a.asset_type_id == payload.asset_type_id and a.code == payload.code):
            return a
    return assets[0]


@router.post("/employees/{employee_id}/assets/{asset_type_id}/photo", response_model=EmployeeAssetPhotoRef)
async def upload_employee_asset_photo(
    employee_id: UUID,
    asset_type_id: UUID,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee assets")
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    await _branch_in_scope(db, current_user, emp.branch_id)

    # Find latest visit or create one
    visit = await db.scalar(
        select(Visit)
        .where(Visit.branch_id == emp.branch_id)
        .order_by(Visit.created_at.desc())
    )
    if not visit:
        visit = Visit(
            branch_id=emp.branch_id,
            status="DRAFT",
            created_by=current_user.id,
        )
        db.add(visit)
        await db.flush()

    # Find or create VisitItAsset row
    row = await db.scalar(
        select(VisitItAsset).where(
            VisitItAsset.visit_id == visit.id,
            VisitItAsset.employee_id == emp.id,
            VisitItAsset.asset_type_id == asset_type_id,
        )
    )
    if not row:
        row = VisitItAsset(
            visit_id=visit.id,
            employee_id=emp.id,
            asset_type_id=asset_type_id,
            created_by=current_user.id,
        )
        db.add(row)
        await db.flush()

    photo = await store_visit_photo(
        db, visit, current_user, file,
        it_asset_row_id=row.id,
        caption=f"Employee {emp.emp_code} asset photo",
    )
    if row.code_photo_id is None:
        row.code_photo_id = photo.id
    if row.status == "PENDING":
        row.status = "VERIFIED"
    await db.flush()

    return EmployeeAssetPhotoRef(
        id=photo.id,
        photo_url=f"/api/v1/photos/{photo.id}/file",
        photo_thumbnail_url=f"/api/v1/photos/{photo.id}/thumbnail",
        captured_at=photo.captured_at or photo.created_at,
    )


@router.delete("/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(
    employee_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee master")
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    emp.is_active = False
    await db.flush()
    return None



# --------------------------------------------------------------------------
# Import helpers
# --------------------------------------------------------------------------
_CODE_KEYS = {"emp code", "empcode", "employee code", "emp_code", "code", "employee id", "employeeid"}
_NAME_KEYS = {"emp name", "empname", "employee name", "emp_name", "name", "employee"}
_DEPT_KEYS = {"department", "dept", "department name", "dept name"}
_BRANCH_KEYS = {"branch", "branch name", "branch code", "branch_name"}
_AREA_KEYS = {"area", "area name"}
_CLUSTER_KEYS = {"cluster", "cluster name"}
_REGION_KEYS = {"region", "region name"}
_STATE_KEYS = {"state", "state name"}
_STATUS_KEYS = {"employment status", "status", "emp status", "employee status"}
_HR_CODE_KEYS = {"hr manager code", "hr code", "hr_manager_code", "hr_manager_code"}
_HR_NAME_KEYS = {"hr manager", "hr_manager", "hr name", "hr_name"}
_ADMIN_NAME_KEYS = {"admin", "admin name", "name"}
_ADMIN_EMAIL_KEYS = {"email id", "email", "e-mail", "mail id"}
_ADMIN_PASSWORD_KEYS = {"password", "pwd"}
_ADMIN_FIRST_NAME_KEYS = {"admin first name", "first name", "firstname"}
_ADMIN_LAST_NAME_KEYS = {"admin last name", "last name", "lastname"}
_DEFAULT_REGIONAL_PASSWORD = "regionaladmin@123"


def _sheet_rows(ws) -> list[list[str]]:
    """Read a worksheet into a plain string grid, with merged cells expanded.

    Merged-cell expansion is essential for the regional-admin sheet: the admin
    name sits in a vertically-merged A2:A6 block ('Shubham' governs
    Chhattisgarh/Madhya Pradesh/Odisha/West Bengal), so every cell inside the
    merge must resolve to the top-left value or the mapping breaks.
    """
    merged_map: dict[tuple[int, int], str] = {}
    try:
        rngs = getattr(ws, "merged_cells", None)
        for rng in (rngs.ranges if rngs else []):
            top_left = ws.cell(row=rng.min_row, column=rng.min_col).value
            text = _cell_text(top_left)
            for row in range(rng.min_row, rng.max_row + 1):
                for col in range(rng.min_col, rng.max_col + 1):
                    merged_map[(row, col)] = text
    except Exception:
        pass
    out: list[list[str]] = []
    for r_idx, r in enumerate(ws.iter_rows(values_only=True), start=1):
        row: list[str] = []
        for c_idx, c in enumerate(r, start=1):
            if c is None and (r_idx, c_idx) in merged_map:
                row.append(merged_map[(r_idx, c_idx)])
            else:
                row.append(_cell_text(c))
        out.append(row)
    return out


def _read_employee_rows(grid: list[list[str]]) -> list[dict]:
    header = [h.lower() for h in grid[0]]
    code_idx = next((i for i, h in enumerate(header) if h in _CODE_KEYS), None)
    name_idx = next((i for i, h in enumerate(header) if h in _NAME_KEYS), None)
    dept_idx = next((i for i, h in enumerate(header) if h in _DEPT_KEYS), None)
    branch_idx = next((i for i, h in enumerate(header) if h in _BRANCH_KEYS), None)
    area_idx = next((i for i, h in enumerate(header) if h in _AREA_KEYS), None)
    if area_idx is None:
        area_idx = next((i for i, h in enumerate(header) if h in _CLUSTER_KEYS), None)
    region_idx = next((i for i, h in enumerate(header) if h in _REGION_KEYS), None)
    state_idx = next((i for i, h in enumerate(header) if h in _STATE_KEYS), None)
    status_idx = next((i for i, h in enumerate(header) if h in _STATUS_KEYS), None)
    hr_code_idx = next((i for i, h in enumerate(header) if h in _HR_CODE_KEYS), None)
    hr_name_idx = next((i for i, h in enumerate(header) if h in _HR_NAME_KEYS), None)

    if code_idx is None and name_idx is None and branch_idx is None:
        code_idx, name_idx = 0, 1
        dept_idx, area_idx, region_idx, branch_idx = 2, 2, 1, 3

    def at(idx: int | None, raw: list[str]) -> str:
        return raw[idx] if idx is not None and idx < len(raw) else ""

    rows = []
    for raw in grid[1:]:
        if not any(raw):
            continue
        rows.append({
            "code": at(code_idx, raw),
            "name": at(name_idx, raw),
            "department": at(dept_idx, raw),
            "area": at(area_idx, raw),
            "region": at(region_idx, raw),
            "state": at(state_idx, raw),
            "branch": at(branch_idx, raw),
            "status": at(status_idx, raw),
            "hr_code": at(hr_code_idx, raw),
            "hr_name": at(hr_name_idx, raw),
        })
    return rows


def _is_exited(status: str) -> bool:
    return status.strip().lower() in ("exited", "inactive", "resigned", "terminated", "left")


def _read_admin_rows(grid: list[list[str]]) -> list[dict]:
    """Parse sheet 2 (regional admin → states → branch links).

    The sheet holds two independent side-by-side tables:
      · left table: admin name in col A (merged vertically across the state
        block it governs) or col B (row-specific override), states in col C;
      · right table (cols F/G/H): header row 'Name / Email Id / Password'
        followed by each admin's full name, email and password.
    Merged cells are already expanded by _sheet_rows, e.g. the A2:A6 merge
    puts 'Shubham' on every state row he governs; a col-B name on the same
    row (Ajeet/Layank/Santosh) takes over that row's state.
    The two tables are joined by name tokens (first/last/prefix); any leftover
    pair is joined by elimination so every admin gets an account when the
    details table has a row for them.
    """
    if len(grid) < 2:
        return []
    blocks: list[dict] = []
    details: list[dict] = []
    current: dict | None = None
    # Col-A values whose merge was interrupted by a col-B override. Once a
    # col-B name appears on a row that also has a col-A value (from a merge),
    # that col-A merge is broken for all subsequent rows: they must not revert
    # to the col-A admin (e.g. A9:A12="Sagar" is interrupted by B10="Santosh",
    # so rows 11-12 must not re-form a "Sagar" block for Tamil Nadu).
    interrupted_col_a: set[str] = set()
    for raw in grid[1:]:
        if not any(raw):
            continue

        def at(i: int) -> str:
            return raw[i] if i < len(raw) else ""

        name_a = at(0).strip()
        name_b = at(1).strip()
        state = at(2).strip()
        full = at(5).strip()
        email = at(6).strip().lower()
        password = at(7).strip()

        # Right-hand details table (skip its header row — 'Email Id' has no @).
        if full or email:
            if email and "@" in email:
                details.append({"full": full or email, "email": email, "password": password})

            # Left table: col B overrides the col-A merged block for that row.
        # A state is only added to a block when the row actually carries the
        # admin's name (col A merged value or col B row-specific override).
        # Rows where col B is empty but col A comes from a merge that was
        # already interrupted by a prior col-B override (e.g. A9:A12=
        # "Sagar" spanning rows 9-12, but row 10 has col B="Santosh" so
        # rows 11-12 must not revert to "Sagar") are treated as no admin.
        short = name_b or name_a
        if name_b and name_a:
            # Col-B override on a row that also has a col-A value (from a
            # merge) interrupts that col-A merge for all following rows.
            interrupted_col_a.add(name_a.lower())
        if short and short.lower() not in ("admin",):
            # If col B is empty and col A was interrupted, treat as no admin.
            if not name_b and name_a and name_a.lower() in interrupted_col_a:
                short = ""
            if short:
                if current is None or short.lower() != current["first"].lower():
                    current = {"first": short, "states": []}
                    blocks.append(current)
                if state and state not in current["states"]:
                    current["states"].append(state)

    def _tokens(name: str) -> list[str]:
        return re.findall(r"[a-z]+", name.lower())

    def _tokens_match(a: str, b: str) -> bool:
        """Token overlap between two names.

        Exact token equality is the strongest signal (e.g. "sagar" appears in
        both "Sagar" and "Boppa Sagar"). Prefix/suffix rules are deliberately
        NOT used: names like "Santosh" and "Santosha" share a 7-char prefix but
        are different people, and a greedy Pass-1 assignment based on that prefix
        would hand Santosha Kumar's email to the Karnataka admin instead of the
        Gujarat admin (Layank) who actually governs that state.
        """
        ta, tb = _tokens(a), _tokens(b)
        for x in ta:
            for y in tb:
                if x == y:
                    return True
        return False

    used: set[str] = set()
    # Pass 1: strongest evidence — token overlap between short and full name.
    for b in blocks:
        for d in details:
            if d["email"] in used:
                continue
            if _tokens_match(b["first"], d["full"]):
                b["full_name"] = d["full"]
                b["email"] = d["email"]
                b["password"] = d["password"] or _DEFAULT_REGIONAL_PASSWORD
                used.add(d["email"])
                break
    # Pass 2: leftovers joined in order of appearance (same count expected).
    for b in blocks:
        if b.get("email"):
            continue
        for d in details:
            if d["email"] in used:
                continue
            b["full_name"] = d["full"]
            b["email"] = d["email"]
            b["password"] = d["password"] or _DEFAULT_REGIONAL_PASSWORD
            used.add(d["email"])
            break
    return [b for b in blocks if b["states"]]


def _sheet_rows_colA_only(ws) -> list[list[str]]:
    """Read a worksheet into a plain string grid, expanding ONLY column-A
    merged ranges.

    Column-A merges (e.g. A2:A6 = "Shubham") must be expanded so every state
    row in the block inherits the admin name. Column-B merges (e.g. B11:B12 =
    "Santosh") must NOT be expanded: a col-B merge that spans multiple states
    would push the admin name onto a state row that has no admin (e.g. Tamil
    Nadu on row 12), incorrectly absorbing it into the previous block.
    """
    # Collect ONLY column-A (min_col == 1) merged ranges.
    col_a_merges: list[tuple[int, int, int]] = []
    try:
        rngs = getattr(ws, "merged_cells", None)
        for rng in (rngs.ranges if rngs else []):
            if rng.min_col == 1 and rng.max_col == 1:
                top_left = ws.cell(row=rng.min_row, column=1).value
                text = _cell_text(top_left)
                col_a_merges.append((rng.min_row, rng.max_row, text))
    except Exception:
        pass
    out: list[list[str]] = []
    for r_idx, r in enumerate(ws.iter_rows(values_only=True), start=1):
        row: list[str] = []
        for c_idx, c in enumerate(r, start=1):
            if c_idx == 1:
                # Column A: resolve via col-A-only merge map.
                text = _cell_text(c)
                if not text:
                    for min_r, max_r, merged_text in col_a_merges:
                        if min_r <= r_idx <= max_r:
                            text = merged_text
                            break
                row.append(text)
            else:
                row.append(_cell_text(c))
        out.append(row)
    return out


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
    """Backwards-compatible single-sheet parser (delegates to _read_employee_rows)."""
    if not grid:
        return []
    return _read_employee_rows(grid)


class _OrgBuilder:
    """Super-admin convenience: creates the Region → Area → Branch chain from
    the file's hierarchy columns on first sight, reusing anything already in
    the database. Keeps in-memory caches so 5k rows only hit the DB once."""

    def __init__(self, db: AsyncSession, created_by: UUID):
        self.db = db
        self.created_by = created_by
        self.regions: dict[str, Region] = {}
        self.areas: dict[tuple, Area] = {}
        self.branches: dict[str, Branch] = {}
        self.created_regions = 0
        self.created_areas = 0
        self.created_branches = 0

    async def load(self):
        for r in (await self.db.execute(select(Region))).scalars().all():
            self.regions.setdefault(r.name.strip().lower(), r)
        for a in (await self.db.execute(select(Area))).scalars().all():
            self.areas.setdefault((str(a.region_id), a.name.strip().lower()), a)
        for b in (await self.db.execute(select(Branch))).scalars().all():
            self.branches.setdefault(b.name.strip().lower(), b)

    async def ensure(self, region_name: str, area_name: str, branch_name: str, state: str | None = None) -> Branch:
        region_name = region_name.strip()
        area_name = area_name.strip()
        branch_name = branch_name.strip()
        if not region_name:
            region_name = "Unassigned"
        if not area_name:
            area_name = region_name

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
            self.created_regions += 1

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
            self.created_areas += 1

        branch = self.branches.get(branch_name.lower())
        if not branch:
            branch = Branch(
                name=branch_name,
                code=await _unique_code(self.db, _code_from_name(branch_name), "branch"),
                region_id=region.id,
                area_id=area.id,
                state=state or None,
                is_active=True,
                created_by=self.created_by,
            )
            self.db.add(branch)
            await self.db.flush()
            self.branches[branch_name.lower()] = branch
            self.created_branches += 1
        return branch

    async def ensure_state_region(self, state_name: str) -> Region:
        """Get-or-create the Region that IS a state (sheet 2 flows). Reuses an
        existing region by case-insensitive name (any state already imported on
        a previous upload) and stamps regions.state for state-first browsing."""
        state_name = state_name.strip()
        if not state_name:
            state_name = "Unassigned"
        region = self.regions.get(state_name.lower())
        if not region:
            region = await self.db.scalar(
                select(Region).where(func.lower(Region.name) == state_name.lower())
            )
            if region:
                self.regions[state_name.lower()] = region
        if not region:
            region = Region(
                name=state_name,
                code=await _unique_code(self.db, _code_from_name(state_name), "region"),
                state=state_name,
                created_by=self.created_by,
            )
            self.db.add(region)
            await self.db.flush()
            self.created_regions += 1
        elif getattr(region, "state", None) != state_name:
            region.state = state_name
        return region


async def _ensure_regional_admins(
    db: AsyncSession,
    actor_id: UUID,
    org: _OrgBuilder,
    admin_rows: list[dict],
) -> None:
    """Sheet 2 importer: per regional admin, ensure one Region per state that
    the admin governs and map the user to those regions.

    State-regions mode: the file's State column drives region creation (a Region
    whose name IS the state, with region.state stamped for state-first browsing).
    Branches auto-created by Sheet 1 then land under the correct state region
    because _OrgBuilder.ensure() reuses the state region by name. For branches
    that already existed in the DB before this import (e.g. from a previous run
    that used the file's Region column as region names, producing regions like
    "MH - Mumbai"), we re-parent any branch whose branch.state matches a state
    region so the whole tree is consistent.
    """
    role = await db.scalar(select(Role).where(Role.name == RoleName.REGIONAL_ADMIN))
    if role is None:
        role = Role(name=RoleName.REGIONAL_ADMIN, is_system=True)
        db.add(role)
        await db.flush()
    # Collect every state that any admin governs (deduplicated, lowercased).
    all_states: list[str] = []
    seen_states: set[str] = set()
    for block in admin_rows:
        for state in (block.get("states") or []):
            key = state.strip().lower()
            if key and key not in seen_states:
                seen_states.add(key)
                all_states.append(state.strip())
    state_lookup = {s.lower(): s for s in all_states}
    # 1. Create state regions + regional admin accounts.
    for block in admin_rows:
        full_name = (block.get("full_name") or block.get("first_name") or "").strip()
        email = (block.get("email") or "").strip().lower()
        password = block.get("password") or _DEFAULT_REGIONAL_PASSWORD
        states = block.get("states") or []
        if not full_name and not states:
            continue
        user = None
        if email:
            user = await db.scalar(select(User).where(User.email == email))
        region_ids: list[UUID] = []
        for state in states:
            region = await org.ensure_state_region(state)
            region_ids.append(region.id)
        if user is None:
            if not full_name:
                continue
            first, _, last = (full_name + " ").partition(" ")
            if not email:
                slug = re.sub(r"[^a-z0-9]+", ".", full_name.lower()).strip(".")
                email = f"{slug or 'regional.admin'}@regional.local"
                user = await db.scalar(select(User).where(User.email == email))
            user = User(
                email=email,
                first_name=first.strip() or full_name,
                last_name=last.strip() or "-",
                hashed_password=get_password_hash(password),
                is_active=True,
                region_id=region_ids[0] if region_ids else None,
                state=", ".join(states) if states else None,
                created_by=actor_id,
            )
            user.roles = [role]
            db.add(user)
            await db.flush()
        else:
            if region_ids:
                user.region_id = region_ids[0]
            if states:
                user.state = ", ".join(states)
            if not user.roles:
                user.roles = [role]
    # 2. Re-parent pre-existing branches whose branch.state matches a state
    #    region, so a previous import that used the file's Region column (e.g.
    #    "MH - Mumbai") still ends up under the right state region.
    if all_states:
        all_branch_stmt = select(Branch).where(Branch.state.isnot(None))
        branches_in_db = (await db.execute(all_branch_stmt)).scalars().all()
        for branch in branches_in_db:
            key = (branch.state or "").strip().lower()
            if key in state_lookup:
                region = await db.scalar(
                    select(Region).where(func.lower(Region.name) == key)
                )
                if region and branch.region_id != region.id:
                    branch.region_id = region.id


@router.post("/employees/import", response_model=EmployeeImportResult)
async def import_employees(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_employees(current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage employee master")

    filename = (file.filename or "import.xlsx").lower()
    if not (filename.endswith(".xlsx") or filename.endswith(".xls") or filename.endswith(".csv")):
        raise HTTPException(status_code=415, detail="Upload a .xlsx/.xls Excel file or .csv file")

    data = await file.read()
    try:
        if filename.endswith(".csv"):
            text = data.decode("utf-8-sig", errors="replace")
            grid = [[_cell_text(c) for c in row] for row in csv.reader(io.StringIO(text))]
            admin_grid = None
        else:
            # Sheet 1 in read-only mode for speed with 5k+ rows; capture
            # sheet names before closing so we know whether sheet 2 exists.
            wb_ro = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            sheet_names = wb_ro.sheetnames
            grid = _sheet_rows(wb_ro[sheet_names[0]])
            wb_ro.close()
            # Sheet 2 (regional admins): needs col-A merge expansion so the
            # vertically-merged admin name (e.g. A2:A6 = "Shubham") lands on
            # every state row in the block. Col-B merges (row-specific overrides
            # like B11:B12 = "Santosh") must NOT be expanded — expanding them
            # would push "Santosh" onto a Tamil-Nadu row that has no admin.
            # ReadOnlyWorksheet exposes no merged_cells, so re-open without
            # read_only only when a second sheet is present.
            admin_grid = None
            if len(sheet_names) > 1:
                wb_full = load_workbook(io.BytesIO(data), read_only=False, data_only=True)
                admin_grid = _sheet_rows_colA_only(wb_full[sheet_names[1]])
                wb_full.close()
        rows = _rows_from_tuples(grid)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the file. Use the provided template format.")

    result = EmployeeImportResult()
    super_admin = is_super_admin(current_user)

    org = _OrgBuilder(db, current_user.id)
    await org.load()

    # ----------------------------------------------------------------------
    # Sheet 2: regional admin -> state -> branch mapping. Creates REGIONAL_ADMIN
    # accounts (email/password if provided) and one Region per state, then
    # links the admin to every branch already known in that state (by branch
    # state, or by the region name that the branch was created under).
    # ----------------------------------------------------------------------
    admin_rows: list[dict] = []
    if admin_grid is not None:
        admin_rows = _read_admin_rows(admin_grid)
        if admin_rows:
            await _ensure_regional_admins(db, current_user.id, org, admin_rows)
            result.created_users = len(admin_rows)
    state_regions_mode = any(a.get("states") for a in admin_rows)

    branch_stmt = select(Branch)
    scope = branch_scope_filter(current_user)
    if scope is not None:
        branch_stmt = branch_stmt.where(scope)
    branches = (await db.execute(branch_stmt)).scalars().all()
    by_code = {b.code.strip().lower(): b for b in branches}
    by_name = {b.name.strip().lower(): b for b in branches}

    existing = {
        e.emp_code.strip().lower(): e
        for e in (await db.execute(select(Employee))).scalars().all()
    }
    # HR manager lookup: by email first, then by name (first + last).
    hr_by_email: dict[str, User] = {}
    hr_by_name: dict[str, User] = {}
    for u in (await db.execute(select(User).where(User.roles.any(Role.name == RoleName.HR)))).scalars().all():
        if u.email:
            hr_by_email[u.email.strip().lower()] = u
        key = f"{u.first_name or ''} {u.last_name or ''}".strip().lower()
        if key:
            hr_by_name[key] = u

    pending_hr_refs: list[tuple[Employee, str, str]] = []
    for idx, row in enumerate(rows, start=2):
        code = row.get("code", "").strip()
        name = row.get("name", "").strip()
        if not code or not name:
            result.skipped += 1
            result.errors.append(f"Row {idx}: missing employee code or name")
            continue

        branch_value = row.get("branch", "").strip()
        if not branch_value:
            result.skipped += 1
            result.errors.append(f"Row {idx}: branch is required")
            continue
        branch = by_code.get(branch_value.lower()) or by_name.get(branch_value.lower())
        if branch is None and super_admin:
            # With a sheet-2 state mapping present, the state IS the region
            # level ("regional with their state... then with branch"), so
            # branches group under a region named after the state. Without
            # sheet 2, the file's Region column drives region creation as before.
            region_value = (
                row.get("state", "") or row.get("region", "")
            ) if state_regions_mode else row.get("region", "")
            branch = await org.ensure(
                region_value,
                row.get("area", "") or row.get("cluster", ""),
                branch_value,
                row.get("state", ""),
            )
        if branch is None:
            result.skipped += 1
            result.errors.append(f"Row {idx}: branch '{branch_value}' not found in your scope")
            continue

        department = row.get("department", "").strip() or None
        is_active = not _is_exited(row.get("status", ""))
        # Resolve HR manager by code (emp_code) or name. A code may reference
        # an employee created LATER in this same file, so failures are parked
        # in pending_hr_refs and retried in a second pass after the loop.
        hr_manager_id = None
        hr_code = row.get("hr_code", "").strip()
        hr_name = row.get("hr_name", "").strip()
        if hr_code:
            hr_target = existing.get(hr_code.lower())
            # Never map an employee as their own HR manager (a few rows in the
            # master file carry their own code in the HR Manager Code column).
            if hr_target is not None and hr_target is not existing.get(code.lower()):
                hr_manager_id = hr_target.id
        if not hr_manager_id and hr_name:
            hr_by_name_key = hr_name.lower()
            hit = hr_by_name.get(hr_by_name_key) or hr_by_email.get(hr_by_name_key)
            if hit:
                hr_manager_id = hit.id
        record = existing.get(code.lower())
        if record:
            prev_hr_id = record.hr_manager_id
            record.name = name
            record.department = department
            record.branch_id = branch.id
            record.hr_manager_id = hr_manager_id
            record.is_active = is_active
            result.updated += 1
            if hr_manager_id and prev_hr_id != hr_manager_id:
                result.created_hr_mappings += 1
        else:
            record = Employee(
                emp_code=code,
                name=name,
                department=department,
                branch_id=branch.id,
                hr_manager_id=hr_manager_id,
                is_active=is_active,
                created_by=current_user.id,
            )
            db.add(record)
            # Register immediately: a duplicate emp code later in the file now
            # UPDATES this row instead of violating the unique constraint, and
            # later rows can already reference it as their HR manager.
            existing[code.lower()] = record
            result.created += 1
            if hr_manager_id:
                result.created_hr_mappings += 1
        if not hr_manager_id and (hr_code or hr_name):
            pending_hr_refs.append((record, hr_code, hr_name))
        result.total += 1

    # Second pass: HR managers that appear later in the file (or whose code
    # column is empty but whose name matches another employee). Requires ids,
    # so flush the pending inserts first.
    if pending_hr_refs:
        await db.flush()
        emp_by_name: dict[str, Employee] = {}
        for e in existing.values():
            key = (e.name or "").strip().lower()
            if key and key not in emp_by_name:
                emp_by_name[key] = e
        resolved = 0
        for emp_obj, hr_code, hr_name in pending_hr_refs:
            target = existing.get(hr_code.lower()) if hr_code else None
            if target is None and hr_name:
                target = emp_by_name.get(hr_name.strip().lower())
            if target is not None and target.id is not None and target is not emp_obj:
                emp_obj.hr_manager_id = target.id
                resolved += 1
        if resolved:
            result.created_hr_mappings += resolved

    result.created_regions = org.created_regions
    result.created_areas = org.created_areas
    result.created_branches = org.created_branches

    # Final re-parenting pass: any branch created during Sheet 1 whose
    # branch.state matches a state region but whose region_id points elsewhere
    # (e.g. a row whose State was empty so region_value fell back to the file's
    # Region column like "MH - Mumbai").
    if state_regions_mode and all_states:
        reparent_stmt = (
            select(Branch).where(
                Branch.state.isnot(None),
                ~Branch.region_id.in_(
                    select(Region.id).where(
                        func.lower(Region.name).in_(state_lookup.keys())
                    )
                ),
            )
        )
        for branch in (await db.execute(reparent_stmt)).scalars().all():
            key = (branch.state or "").strip().lower()
            if key in state_lookup:
                region = await db.scalar(
                    select(Region).where(func.lower(Region.name) == key)
                )
                if region and branch.region_id != region.id:
                    branch.region_id = region.id

    await db.flush()
    return result


# --------------------------------------------------------------------------
# IT Asset Allocations (super-admin device assignment + regional verification)
# --------------------------------------------------------------------------

@router.get("/it-asset-allocations", response_model=ItAssetAllocationList)
async def list_it_asset_allocations(
    employee_id: UUID | None = Query(None, description="Filter by employee"),
    asset_type_id: UUID | None = Query(None, description="Filter by asset type"),
    year: int | None = Query(None, description="Filter by allocation year"),
    status: str | None = Query(None, description="Filter by status"),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ItAssetAllocation).options(
        selectinload(ItAssetAllocation.employee),
        selectinload(ItAssetAllocation.asset_type),
    )
    if employee_id:
        stmt = stmt.where(ItAssetAllocation.employee_id == employee_id)
    if asset_type_id:
        stmt = stmt.where(ItAssetAllocation.asset_type_id == asset_type_id)
    if year:
        stmt = stmt.where(ItAssetAllocation.allocation_year == year)
    if status:
        stmt = stmt.where(ItAssetAllocation.status == status)
    stmt = stmt.order_by(ItAssetAllocation.allocation_year.desc(), ItAssetAllocation.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return ItAssetAllocationList(
        total=len(rows),
        allocations=[
            ItAssetAllocationRead.model_validate(a, from_attributes=True)
            .model_copy(update={
                "employee_name": a.employee.name if a.employee else None,
                "employee_code": a.employee.emp_code if a.employee else None,
                "asset_type_name": a.asset_type.name if a.asset_type else "Unknown",
            })
            for a in rows
        ],
    )


@router.post("/it-asset-allocations", response_model=ItAssetAllocationRead, status_code=status.HTTP_201_CREATED)
async def create_it_asset_allocation(
    payload: ItAssetAllocationCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only super admin can assign devices")
    # Verify the employee exists and is in scope.
    emp = await db.get(Employee, payload.employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    await _branch_in_scope(db, current_user, emp.branch_id)
    # Verify the asset type exists.
    at = await db.get(ItAssetType, payload.asset_type_id)
    if not at:
        raise HTTPException(status_code=404, detail="Asset type not found")
    # Check for duplicate device_code within the same year.
    dup = await db.scalar(
        select(ItAssetAllocation).where(
            ItAssetAllocation.device_code == payload.device_code.strip(),
            ItAssetAllocation.allocation_year == payload.allocation_year,
        )
    )
    if dup:
        raise HTTPException(status_code=409, detail=f"Device code {payload.device_code} already allocated for year {payload.allocation_year}")
    alloc = ItAssetAllocation(
        employee_id=payload.employee_id,
        asset_type_id=payload.asset_type_id,
        device_code=payload.device_code.strip(),
        allocation_year=payload.allocation_year,
        remark=payload.remark.strip() if payload.remark else None,
        created_by=current_user.id,
    )
    db.add(alloc)
    await db.flush()
    return ItAssetAllocationRead.model_validate(alloc, from_attributes=True).model_copy(update={
        "employee_name": emp.name,
        "employee_code": emp.emp_code,
        "asset_type_name": at.name,
    })


@router.patch("/it-asset-allocations/{allocation_id}", response_model=ItAssetAllocationRead)
async def update_it_asset_allocation(
    allocation_id: UUID,
    payload: ItAssetAllocationUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only super admin can update allocations")
    alloc = await db.get(ItAssetAllocation, allocation_id)
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation not found")
    data = payload.model_dump(exclude_unset=True)
    if "device_code" in data and data["device_code"] is not None:
        data["device_code"] = data["device_code"].strip()
    for k, v in data.items():
        setattr(alloc, k, v)
    await db.flush()
    return ItAssetAllocationRead.model_validate(alloc, from_attributes=True).model_copy(update={
        "employee_name": alloc.employee.name if alloc.employee else None,
        "employee_code": alloc.employee.emp_code if alloc.employee else None,
        "asset_type_name": alloc.asset_type.name if alloc.asset_type else "Unknown",
    })


@router.delete("/it-asset-allocations/{allocation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_it_asset_allocation(
    allocation_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only super admin can delete allocations")
    alloc = await db.get(ItAssetAllocation, allocation_id)
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation not found")
    await db.delete(alloc)
    await db.flush()
    return None


@router.get("/it-asset-allocations/{employee_id}/for-year", response_model=list[ItAssetAllocationRead])
async def get_employee_allocations_for_year(
    employee_id: UUID,
    year: int = Query(..., description="Allocation year (e.g. 2026)"),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all device allocations for an employee in a given year.

    Used by regional admins during the annual visit to see what devices
    should be verified for this employee.
    """
    stmt = select(ItAssetAllocation).options(
        selectinload(ItAssetAllocation.employee),
        selectinload(ItAssetAllocation.asset_type),
    ).where(
        ItAssetAllocation.employee_id == employee_id,
        ItAssetAllocation.allocation_year == year,
    ).order_by(ItAssetAllocation.asset_type_id, ItAssetAllocation.device_code)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        ItAssetAllocationRead.model_validate(a, from_attributes=True).model_copy(update={
            "employee_name": a.employee.name if a.employee else None,
            "employee_code": a.employee.emp_code if a.employee else None,
            "asset_type_name": a.asset_type.name if a.asset_type else "Unknown",
        })
        for a in rows
    ]


@router.post("/it-asset-allocations/verify-code", response_model=dict)
async def verify_allocated_code(
    employee_id: UUID,
    asset_type_id: UUID,
    scanned_code: str,
    year: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Regional admin endpoint: verify a scanned device code against the
    super-admin allocation for this employee + asset_type + year.

    Returns {"matched": bool, "allocation": ... , "message": ...}.
    """
    result = await db.scalar(
        select(ItAssetAllocation).where(
            ItAssetAllocation.employee_id == employee_id,
            ItAssetAllocation.asset_type_id == asset_type_id,
            ItAssetAllocation.allocation_year == year,
            ItAssetAllocation.device_code == scanned_code.strip(),
        ).options(
            selectinload(ItAssetAllocation.employee),
            selectinload(ItAssetAllocation.asset_type),
        )
    )
    if result:
        return {
            "matched": True,
            "allocation_id": str(result.id),
            "device_code": result.device_code,
            "allocation_year": result.allocation_year,
            "employee_name": result.employee.name if result.employee else None,
            "asset_type_name": result.asset_type.name if result.asset_type else None,
            "message": f"Code {scanned_code} matches allocation for {result.employee.name if result.employee else 'unknown'}",
        }
    any_alloc = await db.scalar(
        select(ItAssetAllocation).where(
            ItAssetAllocation.employee_id == employee_id,
            ItAssetAllocation.asset_type_id == asset_type_id,
            ItAssetAllocation.allocation_year == year,
        ).options(
            selectinload(ItAssetAllocation.employee),
            selectinload(ItAssetAllocation.asset_type),
        )
    )
    if any_alloc:
        return {
            "matched": False,
            "message": f"Code {scanned_code} does not match any allocated device for {any_alloc.employee.name if any_alloc.employee else 'unknown'} in {year}. Expected: {any_alloc.device_code}",
            "expected_code": any_alloc.device_code,
        }
    return {
        "matched": False,
        "message": f"No device allocated for this employee + {asset_type_id} in {year}.",
    }


# --------------------------------------------------------------------------
# IT asset types (admin-configurable expected assets)
# --------------------------------------------------------------------------
@router.get("/it-asset-types", response_model=list[ItAssetTypeRead])
async def list_it_asset_types(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ItAssetType).order_by(ItAssetType.sort_order, ItAssetType.name)
    )
    return result.scalars().all()


@router.post("/it-asset-types", response_model=ItAssetTypeRead, status_code=status.HTTP_201_CREATED)
async def create_it_asset_type(
    payload: ItAssetTypeCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only super admin can add IT asset types")
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    typ = await db.scalar(select(ItAssetType).where(func.lower(ItAssetType.name) == payload.name.strip().lower()))
    if typ:
        raise HTTPException(status_code=409, detail="Asset type already exists")

    highest = await db.scalar(select(func.max(ItAssetType.sort_order)))
    new_type = ItAssetType(name=payload.name.strip(), sort_order=(highest or 0) + 1, created_by=current_user.id)
    db.add(new_type)
    await db.flush()
    return ItAssetTypeRead.model_validate(new_type, from_attributes=True)


@router.patch("/it-asset-types/{type_id}", response_model=ItAssetTypeRead)
async def update_it_asset_type(
    type_id: UUID,
    payload: ItAssetTypeUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only super admin can edit IT asset types")
    typ = await db.get(ItAssetType, type_id)
    if not typ:
        raise HTTPException(status_code=404, detail="Asset type not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None or field == "is_active":
            setattr(typ, field, value.strip() if isinstance(value, str) else value)
    await db.flush()
    return ItAssetTypeRead.model_validate(typ, from_attributes=True)