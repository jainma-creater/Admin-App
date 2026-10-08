"""Super-admin Inspections console.

Consolidated, filterable grid data for the three inspection visit types
(Branch / Fixed Asset / IT Asset) plus Excel export. Read + export are gated
behind VIEW_REPORT / EXPORT_REPORT, so super admin and reviewers can use it.
"""

from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from openpyxl import Workbook

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission, require_permission_query, branch_scope_filter
from models.org import Area, Branch, Region
from models.asset import Employee, ItAssetType, VisitAsset, VisitItAsset
from models.photo import Photo
from models.visit import Visit, VisitAssignment, VisitChecklistItem, VisitType

router = APIRouter(prefix="/inspections", tags=["inspections"])


# ---------- response models ----------

class PhotoRefLite(BaseModel):
    id: UUID
    photo_url: str | None = None
    photo_thumbnail_url: str | None = None


class InspectionBranchRow(BaseModel):
    visit_id: UUID
    branch_id: UUID
    branch_name: str
    branch_code: str
    region_name: str | None = None
    area_name: str | None = None
    visit_type_name: str
    status: str
    priority: str
    scheduled_date: str | None = None
    submitted_at: str | None = None
    completed_at: str | None = None
    compliance_percentage: float | None = None
    photos: int = 0
    total_items: int = 0
    ok_items: int = 0
    notok_items: int = 0
    submitter: str | None = None
    reviewers: list[str] = []


class InspectionItRow(BaseModel):
    id: UUID
    visit_id: UUID
    visit_status: str
    branch_id: UUID
    branch_name: str
    branch_code: str
    region_name: str | None = None
    area_name: str | None = None
    employee_code: str | None = None
    employee_name: str | None = None
    department: str | None = None
    asset_type_name: str | None = None
    status: str
    code: str | None = None
    remark: str | None = None
    ocr_confirmed: bool = False
    photo: PhotoRefLite | None = None
    photos: int = 0
    submitted_at: str | None = None


class InspectionFixedRow(BaseModel):
    id: UUID
    visit_id: UUID
    visit_status: str
    branch_id: UUID
    branch_name: str
    branch_code: str
    region_name: str | None = None
    area_name: str | None = None
    category: str
    name: str | None = None
    code: str | None = None
    ocr_confirmed: bool = False
    status: str
    photo: PhotoRefLite | None = None
    photos: int = 0
    submitted_at: str | None = None


# ---------- helpers ----------

def _photo_lite(p: Photo) -> PhotoRefLite | None:
    if p is None:
        return None
    return PhotoRefLite(
        id=p.id,
        photo_url=f"/api/v1/photos/{p.id}/file",
        photo_thumbnail_url=f"/api/v1/photos/{p.id}/thumbnail",
    )


def _names(users) -> str | None:
    names = [u.full_name for u in users if u]
    return ", ".join(names) if names else None


async def _org_name_maps(db: AsyncSession, branch_ids: list) -> tuple[dict, dict]:
    """Return ({branch_id: region_name}, {branch_id: area_name}) maps."""
    if not branch_ids:
        return {}, {}
    branches = (await db.execute(
        select(Branch.id, Area.name, Region.name)
        .join(Area, Branch.area_id == Area.id)
        .join(Region, Branch.region_id == Region.id)
        .where(Branch.id.in_(branch_ids))
    )).all()
    region_map = {b_id: r_name for b_id, _a, r_name in branches}
    area_map = {b_id: a_name for b_id, a_name, _r in branches}
    return region_map, area_map


def _add_branch_filter(stmt, branch_id: str | None, current_user=None, branch_cls=Branch):
    """Combine the explicit filter with the caller's org scope so scoped roles
    (HR, Regional Admin, Branch Ops…) can never read other regions' rows —
    even by passing an arbitrary branch_id query param."""
    if branch_id:
        stmt = stmt.where(branch_cls.id == branch_id)
    if current_user is not None:
        scope = branch_scope_filter(current_user)
        if scope is not None:
            stmt = stmt.where(branch_cls.id.in_(select(Branch.id).where(scope)))
    return stmt


def _add_visit_status_filter(stmt, visit_status: str | None):
    if visit_status:
        return stmt.where(Visit.status == visit_status)
    return stmt


# ---------- Branch inspections ----------

@router.get("/branch", response_model=list[InspectionBranchRow])
async def list_branch_inspections(
    branch_id: UUID | None = Query(None),
    visit_status: str | None = Query(None),
    search: str | None = Query(None, max_length=120),
    current_user=Depends(require_permission(Permission.VIEW_REPORT)),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Visit)
        .join(Branch, Visit.branch_id == Branch.id)
        .join(VisitType, Visit.visit_type_id == VisitType.id)
        .options(
            selectinload(Visit.branch),
            selectinload(Visit.visit_type),
            selectinload(Visit.assignments).selectinload(VisitAssignment.user),
        )
        .where(VisitType.name == "Branch Visit")
    )
    stmt = _add_branch_filter(stmt, str(branch_id) if branch_id else None, current_user)
    stmt = _add_visit_status_filter(stmt, visit_status)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(Branch.name.ilike(like), Branch.code.ilike(like)))

    result = await db.execute(
        stmt.order_by(Visit.submitted_at.desc().nullslast(), Visit.created_at.desc())
    )
    visits = result.scalars().all()
    if not visits:
        return []
    ids = [v.id for v in visits]
    region_map, area_map = await _org_name_maps(db, list({v.branch_id for v in visits}))

    photo_counts = dict((await db.execute(
        select(Photo.visit_id, func.count(Photo.id))
        .where(Photo.visit_id.in_(ids))
        .group_by(Photo.visit_id)
    )).all())
    item_counts = {
        vid: (p, ok, nok)
        for vid, p, ok, nok in (await db.execute(
            select(
                VisitChecklistItem.visit_id,
                func.count(VisitChecklistItem.id),
                func.sum(case((VisitChecklistItem.status == "OK", 1), else_=0)),
                func.sum(case((VisitChecklistItem.status == "NOT_OK", 1), else_=0)),
            )
            .where(VisitChecklistItem.visit_id.in_(ids))
            .group_by(VisitChecklistItem.visit_id)
        )).all()
    }

    out = []
    for v in visits:
        visitors = [a.user for a in v.assignments if a.assignment_type == "VISITOR"]
        reviewers = [a.user.full_name for a in v.assignments if a.assignment_type == "REVIEWER" and a.user]
        total, ok, nok = item_counts.get(v.id, (0, 0, 0))
        out.append(InspectionBranchRow(
            visit_id=v.id,
            branch_id=v.branch_id,
            branch_name=v.branch.name or "",
            branch_code=v.branch.code or "",
            region_name=region_map.get(v.branch_id),
            area_name=area_map.get(v.branch_id),
            visit_type_name=v.visit_type.name if v.visit_type else "",
            status=v.status,
            priority=v.priority,
            scheduled_date=v.scheduled_date.isoformat() if v.scheduled_date else None,
            submitted_at=v.submitted_at.isoformat() if v.submitted_at else None,
            completed_at=v.completed_at.isoformat() if v.completed_at else None,
            compliance_percentage=v.compliance_percentage,
            photos=photo_counts.get(v.id, 0),
            total_items=total,
            ok_items=ok or 0,
            notok_items=nok or 0,
            submitter=_names(visitors),
            reviewers=reviewers,
        ))
    return out


# ---------- IT asset inspections ----------

@router.get("/it-assets", response_model=list[InspectionItRow])
async def list_it_asset_inspections(
    branch_id: UUID | None = Query(None),
    visit_status: str | None = Query(None),
    asset_type: str | None = Query(None, max_length=60),
    row_status: str | None = Query(None, max_length=20),
    search: str | None = Query(None, max_length=120),
    current_user=Depends(require_permission(Permission.VIEW_REPORT)),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(VisitItAsset)
        .join(Visit, Visit.id == VisitItAsset.visit_id)
        .join(Branch, Branch.id == Visit.branch_id)
        .join(Employee, Employee.id == VisitItAsset.employee_id)
        .join(ItAssetType, ItAssetType.id == VisitItAsset.asset_type_id)
        .options(
            selectinload(VisitItAsset.employee),
            selectinload(VisitItAsset.asset_type),
            selectinload(VisitItAsset.photos),
            selectinload(VisitItAsset.visit).selectinload(Visit.branch),
        )
        .where(Visit.visit_type.has(VisitType.name == "IT Asset Visit"))
    )
    stmt = _add_branch_filter(stmt, str(branch_id) if branch_id else None, current_user)
    stmt = _add_visit_status_filter(stmt, visit_status)
    if row_status:
        stmt = stmt.where(VisitItAsset.status == row_status)
    if asset_type:
        stmt = stmt.where(ItAssetType.name == asset_type)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(
            Employee.name.ilike(like),
            Employee.emp_code.ilike(like),
            VisitItAsset.code.ilike(like),
        ))

    result = await db.execute(
        stmt.order_by(Visit.submitted_at.desc().nullslast(), VisitItAsset.updated_at.desc())
    )
    rows = result.scalars().all()
    if not rows:
        return []
    region_map, area_map = await _org_name_maps(db, list({r.visit.branch_id for r in rows}))
    out = []
    for r in rows:
        photos = r.photos or []
        first = photos[0] if photos else None
        visit = r.visit
        out.append(InspectionItRow(
            id=r.id,
            visit_id=r.visit_id,
            visit_status=visit.status if visit else None,
            branch_id=visit.branch_id if visit else None,
            branch_name=(visit.branch.name if visit and visit.branch else ""),
            branch_code=(visit.branch.code if visit and visit.branch else ""),
            region_name=region_map.get(visit.branch_id) if visit else None,
            area_name=area_map.get(visit.branch_id) if visit else None,
            employee_code=r.employee.emp_code if r.employee else None,
            employee_name=r.employee.name if r.employee else None,
            department=r.employee.department if r.employee else None,
            asset_type_name=r.asset_type.name if r.asset_type else None,
            status=r.status,
            code=r.code,
            remark=r.remark,
            ocr_confirmed=r.ocr_confirmed,
            photo=_photo_lite(first),
            photos=len(photos),
            submitted_at=visit.submitted_at.isoformat() if visit and visit.submitted_at else None,
        ))
    return out


# ---------- Fixed asset inspections ----------

@router.get("/fixed-assets", response_model=list[InspectionFixedRow])
async def list_fixed_asset_inspections(
    branch_id: UUID | None = Query(None),
    visit_status: str | None = Query(None),
    category: str | None = Query(None, max_length=100),
    row_status: str | None = Query(None, max_length=20),
    search: str | None = Query(None, max_length=120),
    current_user=Depends(require_permission(Permission.VIEW_REPORT)),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(VisitAsset)
        .join(Visit, Visit.id == VisitAsset.visit_id)
        .join(Branch, Branch.id == Visit.branch_id)
        .options(
            selectinload(VisitAsset.photos),
            selectinload(VisitAsset.visit).selectinload(Visit.branch),
        )
        .where(Visit.visit_type.has(VisitType.name == "Fixed Asset Visit"))
    )
    stmt = _add_branch_filter(stmt, str(branch_id) if branch_id else None, current_user)
    stmt = _add_visit_status_filter(stmt, visit_status)
    if row_status:
        stmt = stmt.where(VisitAsset.status == row_status)
    if category:
        stmt = stmt.where(VisitAsset.category.ilike(category.strip()))
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(VisitAsset.name.ilike(like), VisitAsset.code.ilike(like)))

    result = await db.execute(
        stmt.order_by(Visit.submitted_at.desc().nullslast(), VisitAsset.updated_at.desc())
    )
    rows = result.scalars().all()
    if not rows:
        return []
    region_map, area_map = await _org_name_maps(db, list({r.visit.branch_id for r in rows}))
    out = []
    for r in rows:
        photos = r.photos or []
        first = photos[0] if photos else None
        visit = r.visit
        out.append(InspectionFixedRow(
            id=r.id,
            visit_id=r.visit_id,
            visit_status=visit.status if visit else None,
            branch_id=visit.branch_id if visit else None,
            branch_name=(visit.branch.name if visit and visit.branch else ""),
            branch_code=(visit.branch.code if visit and visit.branch else ""),
            region_name=region_map.get(visit.branch_id) if visit else None,
            area_name=area_map.get(visit.branch_id) if visit else None,
            category=r.category,
            name=r.name,
            code=r.code,
            ocr_confirmed=r.ocr_confirmed,
            status=r.status,
            photo=_photo_lite(first),
            photos=len(photos),
            submitted_at=visit.submitted_at.isoformat() if visit and visit.submitted_at else None,
        ))
    return out


# ---------- Excel export ----------

@router.get("/export")
async def export_inspections(
    view: str = Query(..., pattern="^(branch|it-assets|fixed-assets)$"),
    branch_id: UUID | None = Query(None),
    visit_status: str | None = Query(None),
    asset_type: str | None = Query(None),
    category: str | None = Query(None),
    row_status: str | None = Query(None),
    search: str | None = Query(None),
    current_user=Depends(require_permission_query(Permission.EXPORT_REPORT)),
    db: AsyncSession = Depends(get_db),
):
    wb = Workbook()
    ws = wb.active

    if view == "it-assets":
        ws.title = "IT Assets"
        ws.append(["Branch", "Branch Code", "Employee Code", "Employee Name", "Department",
                   "Asset Type", "Code", "Status", "Remark", "Photo Count", "Visit Status",
                   "Submitted At"])
        rows = await list_it_asset_inspections(
            branch_id=branch_id, visit_status=visit_status, asset_type=asset_type,
            row_status=row_status, search=search, current_user=current_user, db=db,
        )
        for r in rows:
            ws.append([r.branch_name, r.branch_code, r.employee_code, r.employee_name,
                       r.department, r.asset_type_name, r.code, r.status, r.remark,
                       r.photos, r.visit_status, r.submitted_at])
        filename = "it-assets-inspections.xlsx"
    elif view == "fixed-assets":
        ws.title = "Fixed Assets"
        ws.append(["Branch", "Branch Code", "Region", "Area", "Category", "Name", "Code",
                   "OCR Verified", "Status", "Photo Count", "Visit Status", "Submitted At"])
        rows = await list_fixed_asset_inspections(
            branch_id=branch_id, visit_status=visit_status, category=category,
            row_status=row_status, search=search, current_user=current_user, db=db,
        )
        for r in rows:
            ws.append([r.branch_name, r.branch_code, r.region_name, r.area_name, r.category,
                       r.name, r.code, "Yes" if r.ocr_confirmed else "No", r.status,
                       r.photos, r.visit_status, r.submitted_at])
        filename = "fixed-assets-inspections.xlsx"
    else:
        ws.title = "Branch Inspections"
        ws.append(["Branch", "Branch Code", "Region", "Area", "Status", "Priority",
                   "Scheduled Date", "Submitted At", "Compliance %", "Photos", "Total Items",
                   "OK", "Not OK", "Submitter", "Reviewers"])
        rows = await list_branch_inspections(
            branch_id=branch_id, visit_status=visit_status, search=search,
            current_user=current_user, db=db,
        )
        for r in rows:
            ws.append([r.branch_name, r.branch_code, r.region_name, r.area_name, r.status,
                       r.priority, r.scheduled_date, r.submitted_at, r.compliance_percentage,
                       r.photos, r.total_items, r.ok_items, r.notok_items, r.submitter,
                       ", ".join(r.reviewers)])
        filename = "branch-inspections.xlsx"

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )