from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission, RoleName
from api.deps import (
    require_permission,
    get_current_user,
    can_access_branch,
    branch_scope_filter,
    user_role_names,
    is_super_admin,
)
from models.user import User, Role, user_roles
from models.org import Branch
from models.checklist import ChecklistTemplate, ChecklistSection, ChecklistItem
from models.visit import (
    VisitType,
    Visit,
    VisitAssignment,
    VisitChecklistItem,
)
from models.action import CorrectiveAction
from models.photo import Photo
from models.asset import VisitAsset, VisitItAsset
from models.idempotency import ClientIdempotency
from services.visit_service import transition, VisitStateError
from schemas.visit import (
    VisitCreate,
    VisitUpdate,
    VisitRead,
    VisitWithDetails,
    VisitChecklistItemUpdate,
    ChecklistResponse,
)
from utils.audit import AuditLogger
from utils import audit as audit_utils
from core.visit_access import (
    ANSWERED_IT_STATUSES,
    SKIP_TEMPLATE_VISIT_TYPES,
    user_may_start_visit,
)

router = APIRouter(prefix="/visits", tags=["visits"])

REVIEW_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "REWORK_REQUIRED", "RESUBMITTED")

# Map system roles to checklist role tags from Excel
# HR carries BOTH tags: the Excel "HR" column marks HR-specific checkpoints and
# (per the customer) HR also performs the shared "OPS" branch-ops checks.
ROLE_TO_CHECKLIST_TAG = {
    RoleName.ADMIN: "ADMIN",
    RoleName.HOD: "ADMIN",
    RoleName.SUPER_ADMIN: "ADMIN",  # Super admin sees everything (override below)
    RoleName.HR: "HR",
    RoleName.AUDITOR: "OPS",
    RoleName.REGIONAL_ADMIN: "OPS",
    RoleName.AREA_MANAGER: "OPS",
    RoleName.BRANCH_MANAGER: "OTHERS",
}

# Roles whose checklist view intentionally spans MULTIPLE tags.
EXTRA_CHECKLIST_TAGS: dict[str, set[str]] = {
    RoleName.HR.value: {"OPS"},
}


def get_user_checklist_tags(user: User) -> set[str]:
    """Get checklist role tags for the current user based on their system roles."""
    if is_super_admin(user):
        return {"ADMIN", "HR", "OPS", "OTHERS"}  # Super admin sees all
    user_roles = user_role_names(user)
    tags = set()
    for role in user_roles:
        if role in ROLE_TO_CHECKLIST_TAG:
            tags.add(ROLE_TO_CHECKLIST_TAG[role])
    for role in user_roles:
        tags |= EXTRA_CHECKLIST_TAGS.get(role, set())
    return tags


def filter_checklist_items_by_role(items: list[ChecklistItem], user_tags: set[str]) -> list[ChecklistItem]:
    """Filter checklist items based on user's role tags.
    
    Items with empty role_tags are visible to everyone.
    Items with role_tags are visible only if user has at least one matching tag.
    """
    if not user_tags:
        return [item for item in items if not item.role_tags]
    
    filtered = []
    for item in items:
        item_tags = set(item.role_tags or [])
        if not item_tags:  # Empty = visible to all
            filtered.append(item)
        elif user_tags & item_tags:  # Intersection = has matching role
            filtered.append(item)
    return filtered


async def _attach_template(db: AsyncSession, visit: Visit):
    """Attach the active template for the visit type, with automatic fallback."""
    result = await db.execute(
        select(ChecklistTemplate)
        .where(ChecklistTemplate.is_active.is_(True))
        .order_by(ChecklistTemplate.is_published.desc(), ChecklistTemplate.created_at.desc())
    )
    templates = result.scalars().all()

    if visit.visit_type_id:
        for t in templates:
            if t.visit_type_id == visit.visit_type_id:
                visit.template_id = t.id
                break
    if not visit.template_id and templates:
        visit.template_id = templates[0].id

    # Fallback to any available template if still not attached
    if not visit.template_id:
        any_t = await db.execute(select(ChecklistTemplate).order_by(ChecklistTemplate.created_at.desc()).limit(1))
        found = any_t.scalar_one_or_none()
        if found:
            visit.template_id = found.id



async def _hydrate_visit_items(db: AsyncSession, visit: Visit):
    """Create VisitChecklistItem rows from the template items."""
    if not visit.template_id:
        return
    result = await db.execute(
        select(ChecklistItem)
        .join(ChecklistSection, ChecklistItem.section_id == ChecklistSection.id)
        .join(ChecklistTemplate, ChecklistSection.template_id == ChecklistTemplate.id)
        .where(
            ChecklistTemplate.id == visit.template_id,
            ChecklistItem.is_active.is_(True),
        )
        .order_by(ChecklistSection.sort_order, ChecklistItem.sort_order)
    )
    items = result.scalars().all()

    existing = await db.execute(
        select(VisitChecklistItem.checklist_item_id).where(VisitChecklistItem.visit_id == visit.id)
    )
    existing_ids = {r for (r,) in existing.all()}

    added = False
    for item in items:
        if item.id in existing_ids:
            continue
        try:
            db.add(VisitChecklistItem(
                visit_id=visit.id,
                checklist_item_id=item.id,
                created_by=visit.created_by,
            ))
            added = True
        except Exception:
            continue
    if added:
        try:
            await db.flush()
        except IntegrityError:
            # Concurrent hydration already inserted some rows; the unique
            # constraint (visit_id, checklist_item_id) makes this safe to recover
            # by simply ignoring the losers of the race.
            await db.rollback()
            for item in items:
                existing = await db.execute(
                    select(VisitChecklistItem).where(
                        VisitChecklistItem.visit_id == visit.id,
                        VisitChecklistItem.checklist_item_id == item.id,
                    )
                )
                if not existing.scalars().first():
                    db.add(VisitChecklistItem(
                        visit_id=visit.id,
                        checklist_item_id=item.id,
                        created_by=visit.created_by,
                    ))
            await db.flush()


def _can_respond(user: User, visit: Visit, assignment_user_ids: set[UUID]) -> bool:
    if is_super_admin(user):
        return True
    roles = user_role_names(user)
    if user.id in assignment_user_ids:
        return True
    # Admins, HOD, HR can generally respond too
    if any(r in roles for r in (RoleName.ADMIN, RoleName.HOD, RoleName.HR)):
        return True
    # Regional admins and area managers on scoped visits
    if RoleName.REGIONAL_ADMIN in roles or RoleName.AREA_MANAGER in roles:
        return True
    return False


def _can_review(user: User, visit: Visit, reviewer_ids: set[UUID]) -> bool:
    if is_super_admin(user):
        return True
    roles = user_role_names(user)
    if user.id in reviewer_ids:
        return True
    if any(r in roles for r in (RoleName.ADMIN, RoleName.HOD, RoleName.AUDITOR)):
        return True
    return False


@router.get("", response_model=list[VisitWithDetails])
async def list_visits(
    status_filter: str | None = Query(None, alias="status"),
    branch_id: UUID | None = None,
    visit_type_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    assigned_to: UUID | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    current_user=Depends(require_permission(Permission.READ_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Visit)
        .options(
            selectinload(Visit.assignments).selectinload(VisitAssignment.user),
            selectinload(Visit.branch),
            selectinload(Visit.visit_type),
        )
        .order_by(Visit.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    if status_filter:
        stmt = stmt.where(Visit.status == status_filter)
    if branch_id:
        stmt = stmt.where(Visit.branch_id == branch_id)
    if visit_type_id:
        stmt = stmt.where(Visit.visit_type_id == visit_type_id)
    if date_from:
        stmt = stmt.where(Visit.scheduled_date >= date_from)
    if date_to:
        stmt = stmt.where(Visit.scheduled_date <= date_to)
    if assigned_to:
        stmt = stmt.where(
            Visit.id.in_(
                select(VisitAssignment.visit_id).where(VisitAssignment.user_id == assigned_to)
            )
        )

    scope = branch_scope_filter(current_user)
    if scope is not None:
        stmt = stmt.where(
            Visit.branch_id.in_(select(Branch.id).where(scope))
        )

    result = await db.execute(stmt)
    visits = result.scalars().all()

    # count items for progress
    total_items_map, completed_map = await _progress_counts(
        db, [v.id for v in visits], get_user_checklist_tags(current_user)
    )
    failed_map = {}
    action_map = {}
    photo_map = {}
    if visits:
        vids = [v.id for v in visits]
        fail_result = await db.execute(
            select(VisitChecklistItem.visit_id, func.count(VisitChecklistItem.id))
            .where(VisitChecklistItem.visit_id.in_(vids), VisitChecklistItem.status == "NOT_OK")
            .group_by(VisitChecklistItem.visit_id)
        )
        failed_map = dict(fail_result.all())

        act_result = await db.execute(
            select(CorrectiveAction.visit_id, func.count(CorrectiveAction.id))
            .where(CorrectiveAction.visit_id.in_(vids))
            .group_by(CorrectiveAction.visit_id)
        )
        action_map = dict(act_result.all())

        ph_result = await db.execute(
            select(Photo.visit_id, func.count(Photo.id))
            .where(Photo.visit_id.in_(vids))
            .group_by(Photo.visit_id)
        )
        photo_map = dict(ph_result.all())

    out = []
    for v in visits:
        item = VisitWithDetails.model_validate(v, from_attributes=True)
        item.branch_name = v.branch.name if v.branch else None
        item.branch_code = v.branch.code if v.branch else None
        item.visit_type_name = v.visit_type.name if v.visit_type else None
        item.visitors = [
            {"id": a.user_id, "name": (a.user.full_name if a.user else None)}
            for a in v.assignments if a.assignment_type == "VISITOR"
        ]
        item.reviewers = [
            {"id": a.user_id, "name": (a.user.full_name if a.user else None)}
            for a in v.assignments if a.assignment_type == "REVIEWER"
        ]
        item.total_items = int(total_items_map.get(v.id, 0))
        item.completed_items = int(completed_map.get(v.id, 0))
        item.failed_items = int(failed_map.get(v.id, 0))
        item.action_count = int(action_map.get(v.id, 0))
        item.photo_count = int(photo_map.get(v.id, 0))
        out.append(item)
    return out


@router.get("/my", response_model=list[VisitWithDetails])
async def my_visits(
    current_user=Depends(require_permission(Permission.READ_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    sub = select(VisitAssignment.visit_id).where(VisitAssignment.user_id == current_user.id)
    stmt = (
        select(Visit)
        .options(selectinload(Visit.assignments), selectinload(Visit.branch), selectinload(Visit.visit_type))
        .where(Visit.id.in_(sub))
        .order_by(Visit.scheduled_date.is_(None), Visit.scheduled_date)
    )
    result = await db.execute(stmt)
    visits = result.scalars().all()

    # Populate item/photo counts (were left at defaults -> app showed "0/0 items")
    vids = [v.id for v in visits]
    user_tags = get_user_checklist_tags(current_user)
    total_map, completed_map = await _progress_counts(db, vids, user_tags)
    photo_map: dict = {}
    if vids:
        p_res = await db.execute(
            select(Photo.visit_id, func.count(Photo.id))
            .where(Photo.visit_id.in_(vids))
            .group_by(Photo.visit_id)
        )
        photo_map = dict(p_res.all())

    out = []
    for v in visits:
        item = VisitWithDetails.model_validate(v, from_attributes=True)
        item.branch_name = v.branch.name if v.branch else None
        item.branch_code = v.branch.code if v.branch else None
        item.visit_type_name = v.visit_type.name if v.visit_type else None
        item.total_items = int(total_map.get(v.id, 0))
        item.completed_items = int(completed_map.get(v.id, 0))
        item.photo_count = int(photo_map.get(v.id, 0))
        out.append(item)
    return out


@router.post("", response_model=VisitWithDetails, status_code=status.HTTP_201_CREATED)
async def create_visit(
    payload: VisitCreate,
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    x_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
    current_user=Depends(require_permission(Permission.CREATE_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    # Idempotent create for offline clients: replaying the same request
    # (device id + client-generated key) returns the visit they already made
    # instead of creating a duplicate.
    if x_device_id and x_idempotency_key:
        replay = await db.scalar(
            select(ClientIdempotency).where(
                ClientIdempotency.key == x_idempotency_key,
                ClientIdempotency.user_id == current_user.id,
                ClientIdempotency.method == "POST",
                ClientIdempotency.path == "/visits",
            )
        )
        if replay:
            return await _to_details(db, replay.entity_id, get_user_checklist_tags(current_user))

    branch_result = await db.execute(select(Branch).where(Branch.id == payload.branch_id))
    branch = branch_result.scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    vt_result = await db.execute(select(VisitType).where(VisitType.id == payload.visit_type_id))
    vtype = vt_result.scalar_one_or_none()
    if not vtype:
        raise HTTPException(status_code=404, detail="Visit type not found")
    if not user_may_start_visit(current_user, vtype.name):
        raise HTTPException(
            status_code=403,
            detail=f"Your role cannot start a {vtype.name}.",
        )

    visit = Visit(
        branch_id=payload.branch_id,
        visit_type_id=payload.visit_type_id,
        scheduled_date=payload.scheduled_date,
        priority=payload.priority,
        instructions=payload.instructions,
        status="DRAFT",
        created_by=current_user.id,
    )
    db.add(visit)
    await db.flush()

    is_module_visit = vtype.name in SKIP_TEMPLATE_VISIT_TYPES
    if not is_module_visit:
        await _attach_template(db, visit)
        await _hydrate_visit_items(db, visit)

    visitor_ids = payload.visitor_ids or []
    reviewer_ids = payload.reviewer_ids or []
    for uid in visitor_ids:
        db.add(VisitAssignment(visit_id=visit.id, user_id=uid, assignment_type="VISITOR"))
    for uid in reviewer_ids:
        db.add(VisitAssignment(visit_id=visit.id, user_id=uid, assignment_type="REVIEWER"))

    # Auto-attach an admin reviewer when the creator did not pick one, so the
    # super-admin Inspections console always sees submitted inspections.
    if not reviewer_ids:
        admins = await db.execute(
            select(User)
            .join(user_roles, User.id == user_roles.c.user_id)
            .join(Role, Role.id == user_roles.c.role_id)
            .where(
                Role.name.in_([RoleName.SUPER_ADMIN, RoleName.ADMIN]),
                User.is_active.is_(True),
            )
        )
        seen: set = set()
        for admin in admins.scalars().all():
            if admin.id in seen:
                continue
            seen.add(admin.id)
            db.add(VisitAssignment(visit_id=visit.id, user_id=admin.id, assignment_type="REVIEWER"))

    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_CREATED", entity_type="visit", entity_id=visit.id,
                          request=None)

    # Notification to visitors
    for uid in visitor_ids:
        audit_utils.create_notification(
            db, user_id=uid, title="New Branch Visit Assigned",
            body=f"A visit has been assigned to you at {branch.name}.",
            notif_type="VISIT_ASSIGNED", entity_type="visit", entity_id=visit.id,
        )

    await db.flush()

    if x_device_id and x_idempotency_key:
        db.add(ClientIdempotency(
            key=x_idempotency_key,
            user_id=current_user.id,
            method="POST",
            path="/visits",
            entity_type="visit",
            entity_id=visit.id,
        ))
        await db.flush()

    return await _to_details(db, visit.id, get_user_checklist_tags(current_user))


async def _to_details(db: AsyncSession, visit_id, user_tags: set[str] | None = None) -> VisitWithDetails:
    result = await db.execute(
        select(Visit)
        .options(
            selectinload(Visit.assignments).selectinload(VisitAssignment.user),
            selectinload(Visit.branch),
            selectinload(Visit.visit_type),
        )
        .where(Visit.id == visit_id)
    )
    v = result.scalar_one()
    item = VisitWithDetails.model_validate(v, from_attributes=True)
    item.branch_name = v.branch.name if v.branch else None
    item.branch_code = v.branch.code if v.branch else None
    item.visit_type_name = v.visit_type.name if v.visit_type else None
    item.visitors = [{"id": a.user_id, "name": a.user.full_name} for a in v.assignments if a.assignment_type == "VISITOR"]
    item.reviewers = [{"id": a.user_id, "name": a.user.full_name} for a in v.assignments if a.assignment_type == "REVIEWER"]

    count_result = await db.execute(
        select(func.count(VisitChecklistItem.id)).where(VisitChecklistItem.visit_id == visit_id)
    )
    item.total_items = count_result.scalar() or 0

    if item.total_items == 0:
        is_module_visit = v.visit_type and v.visit_type.name in SKIP_TEMPLATE_VISIT_TYPES
        if not is_module_visit:
            if not v.template_id:
                await _attach_template(db, v)
            if v.template_id:
                await _hydrate_visit_items(db, v)
                await db.flush()
                new_count = await db.execute(
                    select(func.count(VisitChecklistItem.id)).where(VisitChecklistItem.visit_id == visit_id)
                )
                item.total_items = new_count.scalar() or 0

    comp_result = await db.execute(
        select(func.count(VisitChecklistItem.id)).where(
            VisitChecklistItem.visit_id == visit_id, VisitChecklistItem.is_completed.is_(True)
        )
    )
    item.completed_items = comp_result.scalar() or 0

    # For module visits (Fixed Asset / IT Asset): compute accurate asset counts
    is_module_visit = v.visit_type and v.visit_type.name in SKIP_TEMPLATE_VISIT_TYPES
    if is_module_visit:
        if v.visit_type.name == "Fixed Asset Visit":
            tot = await db.scalar(select(func.count(VisitAsset.id)).where(VisitAsset.visit_id == visit_id)) or 0
            done = await db.scalar(
                select(func.count(VisitAsset.id)).where(
                    VisitAsset.visit_id == visit_id,
                    VisitAsset.code.isnot(None),
                    VisitAsset.code != "",
                )
            ) or 0
            item.total_items = tot
            item.completed_items = done
        elif v.visit_type.name == "IT Asset Visit":
            tot = await db.scalar(select(func.count(VisitItAsset.id)).where(VisitItAsset.visit_id == visit_id)) or 0
            done = await db.scalar(
                select(func.count(VisitItAsset.id)).where(
                    VisitItAsset.visit_id == visit_id,
                    VisitItAsset.status.in_(["VERIFIED", "NOT_FOUND"]),
                )
            ) or 0
            item.total_items = tot
            item.completed_items = done

    # Progress shown to the caller counts only the items that caller may answer,
    # so a 65-item shared template doesn't render a permanent 0/65 for HR.
    if user_tags is not None and not is_module_visit:
        total_map, completed_map = await _progress_counts(db, [visit_id], user_tags)
        item.total_items = int(total_map.get(visit_id, 0))
        item.completed_items = int(completed_map.get(visit_id, 0))
    fail_result = await db.execute(
        select(func.count(VisitChecklistItem.id)).where(
            VisitChecklistItem.visit_id == visit_id, VisitChecklistItem.status == "NOT_OK"
        )
    )
    item.failed_items = fail_result.scalar() or 0
    act_result = await db.execute(
        select(func.count(CorrectiveAction.id)).where(CorrectiveAction.visit_id == visit_id)
    )
    item.action_count = act_result.scalar() or 0
    ph_result = await db.execute(
        select(func.count(Photo.id)).where(Photo.visit_id == visit_id)
    )
    item.photo_count = ph_result.scalar() or 0
    return item


def _item_visible(role_tags, user_tags: set[str]) -> bool:
    """An item is visible to a user when it is untagged (everyone) or carries
    one of the user's role tags. Mirrors filter_checklist_items_by_role()."""
    tags = set(role_tags or [])
    if not tags:
        return True
    if not user_tags:
        return False
    return bool(user_tags & tags)


async def _progress_counts(
    db: AsyncSession,
    vids: list[UUID],
    user_tags: set[str],
) -> tuple[dict, dict]:
    """(total_map, completed_map) of checklist progress per visit, counting
    only the items THIS user is expected to answer.

    A 65-item template is shared by all roles; HR answers the HR-tagged subset
    only. Counting every row made the mobile/web progress read 0/65 forever —
    the answered items can never reach a denominator that includes other roles'
    checkpoints. Super admins (all tags) still see the full template.
    """
    total_map: dict = {}
    completed_map: dict = {}
    if not vids:
        return total_map, completed_map

    rows = (
        await db.execute(
            select(
                VisitChecklistItem.visit_id,
                VisitChecklistItem.is_completed,
                ChecklistItem.role_tags,
            )
            .join(ChecklistItem, ChecklistItem.id == VisitChecklistItem.checklist_item_id)
            .where(VisitChecklistItem.visit_id.in_(vids))
        )
    ).all()
    for visit_id, is_completed, role_tags in rows:
        if not _item_visible(role_tags, user_tags):
            continue
        total_map[visit_id] = total_map.get(visit_id, 0) + 1
        if is_completed:
            completed_map[visit_id] = completed_map.get(visit_id, 0) + 1

    # For module visits (Fixed Asset / IT Asset) that have no checklist rows:
    remaining_vids = [v for v in vids if v not in total_map]
    if remaining_vids:
        # Fixed assets
        fa_rows = (
            await db.execute(
                select(VisitAsset.visit_id, VisitAsset.code).where(VisitAsset.visit_id.in_(remaining_vids))
            )
        ).all()
        for vid, code in fa_rows:
            total_map[vid] = total_map.get(vid, 0) + 1
            if code and code.strip():
                completed_map[vid] = completed_map.get(vid, 0) + 1

        # IT assets
        it_rows = (
            await db.execute(
                select(VisitItAsset.visit_id, VisitItAsset.status).where(VisitItAsset.visit_id.in_(remaining_vids))
            )
        ).all()
        for vid, it_status in it_rows:
            total_map[vid] = total_map.get(vid, 0) + 1
            if it_status in ("VERIFIED", "NOT_FOUND"):
                completed_map[vid] = completed_map.get(vid, 0) + 1

    return total_map, completed_map


@router.get("/{visit_id}", response_model=VisitWithDetails)
async def get_visit(
    visit_id: UUID,
    current_user=Depends(require_permission(Permission.READ_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit).options(
            selectinload(Visit.assignments).selectinload(VisitAssignment.user),
            selectinload(Visit.branch),
            selectinload(Visit.visit_type),
        ).where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if visit.branch and not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.patch("/{visit_id}", response_model=VisitWithDetails)
async def update_visit(
    visit_id: UUID,
    payload: VisitUpdate,
    current_user=Depends(require_permission(Permission.UPDATE_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Visit).where(Visit.id == visit_id))
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(visit, key, value)
    visit.updated_by = current_user.id
    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_UPDATED", entity_type="visit", entity_id=visit.id)
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.post("/{visit_id}/start", response_model=VisitWithDetails)
async def start_visit(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Visit).where(Visit.id == visit_id))
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        visit.status = transition(visit.status, "IN_PROGRESS")
    except VisitStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not visit.started_at:
        visit.started_at = datetime.now(timezone.utc)
    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_STARTED", entity_type="visit", entity_id=visit.id)
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.post("/{visit_id}/submit", response_model=VisitWithDetails)
async def submit_visit(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit)
        .options(selectinload(Visit.assignments))
        .where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    assignment_ids = {a.user_id for a in visit.assignments if a.assignment_type == "VISITOR"}
    if not _can_respond(current_user, visit, assignment_ids):
        raise HTTPException(status_code=403, detail="Only the assigned visitor or an admin can submit")

    # Submissions can proceed even if incomplete so reviewers/HODs can review
    # early findings, blurry evidence, or partial inspection progress.
    user_tags = get_user_checklist_tags(current_user)

    # Already submitted/reviewed: a resubmit tap is harmless — return as-is
    # instead of failing with "SUBMITTED -> SUBMITTED".
    if visit.status in ("SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"):
        try:
            await db.commit()
        except Exception:
            await db.rollback()
        return await _to_details(db, visit_id, get_user_checklist_tags(current_user))

    try:
        visit.status = transition(visit.status, "SUBMITTED")
    except VisitStateError as e:
        raise HTTPException(status_code=409, detail=str(e))

    visit.submitted_at = datetime.now(timezone.utc)

    # Compute compliance percentage from whatever items were answered
    ok_result = await db.execute(
        select(func.count(VisitChecklistItem.id)).where(
            VisitChecklistItem.visit_id == visit_id,
            VisitChecklistItem.status == "OK",
        )
    )
    notok_result = await db.execute(
        select(func.count(VisitChecklistItem.id)).where(
            VisitChecklistItem.visit_id == visit_id,
            VisitChecklistItem.status == "NOT_OK",
        )
    )
    ok = ok_result.scalar() or 0
    notok = notok_result.scalar() or 0
    denom = ok + notok
    visit.compliance_percentage = round(ok / denom * 100.0, 1) if denom else None

    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_SUBMITTED", entity_type="visit", entity_id=visit.id)

    # Notify reviewers
    reviewers = [a.user_id for a in visit.assignments if a.assignment_type == "REVIEWER"]
    for rid in reviewers:
        audit_utils.create_notification(
            db, user_id=rid, title="Visit Submitted for Review",
            body="A branch visit requires your review.",
            notif_type="REVIEW_REQUIRED", entity_type="visit", entity_id=visit.id,
        )
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.post("/{visit_id}/review", response_model=VisitWithDetails)
async def start_review(
    visit_id: UUID,
    current_user=Depends(require_permission(Permission.REVIEW_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit)
        .options(selectinload(Visit.assignments))
        .where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    reviewer_ids = {a.user_id for a in visit.assignments if a.assignment_type == "REVIEWER"}
    if not _can_review(current_user, visit, reviewer_ids):
        raise HTTPException(status_code=403, detail="Not authorized to review this visit")

    try:
        visit.status = transition(visit.status, "UNDER_REVIEW")
    except VisitStateError as e:
        raise HTTPException(status_code=409, detail=str(e))

    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_REVIEWED", entity_type="visit", entity_id=visit.id)
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.post("/{visit_id}/approve", response_model=VisitWithDetails)
async def approve_visit(
    visit_id: UUID,
    current_user=Depends(require_permission(Permission.APPROVE_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit)
        .options(selectinload(Visit.assignments))
        .where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    reviewer_ids = {a.user_id for a in visit.assignments if a.assignment_type == "REVIEWER"}
    if not _can_review(current_user, visit, reviewer_ids):
        raise HTTPException(status_code=403, detail="Not authorized to review this visit")

    try:
        visit.status = transition(visit.status, "APPROVED")
    except VisitStateError as e:
        raise HTTPException(status_code=409, detail=str(e))

    from models.misc import VisitReview
    db.add(VisitReview(
        visit_id=visit.id,
        reviewer_id=current_user.id,
        decision="APPROVED",
        comments=None,
        reviewed_at=datetime.now(timezone.utc),
    ))
    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_APPROVED", entity_type="visit", entity_id=visit.id)
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.post("/{visit_id}/reject", response_model=VisitWithDetails)
async def reject_visit(
    visit_id: UUID,
    payload: dict = None,
    current_user=Depends(require_permission(Permission.REJECT_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit)
        .options(selectinload(Visit.assignments))
        .where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    reviewer_ids = {a.user_id for a in visit.assignments if a.assignment_type == "REVIEWER"}
    if not _can_review(current_user, visit, reviewer_ids):
        raise HTTPException(status_code=403, detail="Not authorized to review this visit")

    try:
        visit.status = transition(visit.status, "REJECTED")
    except VisitStateError as e:
        raise HTTPException(status_code=409, detail=str(e))

    comments = (payload or {}).get("comments")
    from models.misc import VisitReview
    db.add(VisitReview(
        visit_id=visit.id,
        reviewer_id=current_user.id,
        decision="REJECTED",
        comments=comments,
        reviewed_at=datetime.now(timezone.utc),
    ))
    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_REJECTED", entity_type="visit", entity_id=visit.id,
                          details={"comments": comments})
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.post("/{visit_id}/rework", response_model=VisitWithDetails)
async def send_rework(
    visit_id: UUID,
    payload: dict = None,
    current_user=Depends(require_permission(Permission.REJECT_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Visit).where(Visit.id == visit_id))
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    try:
        visit.status = transition(visit.status, "REWORK_REQUIRED")
    except VisitStateError as e:
        raise HTTPException(status_code=409, detail=str(e))

    comments = (payload or {}).get("comments")
    from models.misc import VisitReview
    db.add(VisitReview(
        visit_id=visit.id,
        reviewer_id=current_user.id,
        decision="REWORK_REQUIRED",
        comments=comments,
        reviewed_at=datetime.now(timezone.utc),
    ))
    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_REWORK_REQUIRED", entity_type="visit", entity_id=visit.id,
                          details={"comments": comments})
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


@router.post("/{visit_id}/close", response_model=VisitWithDetails)
async def close_visit(
    visit_id: UUID,
    current_user=Depends(require_permission(Permission.APPROVE_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Visit).where(Visit.id == visit_id))
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    try:
        visit.status = transition(visit.status, "CLOSED")
    except VisitStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    visit.completed_at = datetime.now(timezone.utc)
    await AuditLogger.log(db, user_id=current_user.id,
                          action="VISIT_CLOSED", entity_type="visit", entity_id=visit.id)
    return await _to_details(db, visit_id, get_user_checklist_tags(current_user))


# ---------- Checklist responses ----------

@router.get("/{visit_id}/checklist", response_model=ChecklistResponse)
async def get_visit_checklist(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit).options(selectinload(Visit.branch)).where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    if not visit.template_id:
        raise HTTPException(status_code=400, detail="No checklist template attached to this visit")

    t_result = await db.execute(
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
        .where(ChecklistTemplate.id == visit.template_id)
    )
    template = t_result.scalar_one()

    # Get user's checklist role tags
    user_tags = get_user_checklist_tags(current_user)

    # Filter template items by user's roles.
    # IMPORTANT: never mutate sec.items (that relationship is managed by the ORM
    # and would orphan-delete filtered-out items from the DB on flush). Copy instead.
    filtered_sections = []
    for sec in template.sections:
        filtered_sections.append((sec, list(filter_checklist_items_by_role(sec.items, user_tags))))

    # Self-heal: ensure all active template items exist as VisitChecklistItem rows
    if template.sections:
        await _hydrate_visit_items(db, visit)

    v_items_result = await db.execute(
        select(VisitChecklistItem)
        .options(selectinload(VisitChecklistItem.checklist_item), selectinload(VisitChecklistItem.responsible_person))
        .where(VisitChecklistItem.visit_id == visit_id)
    )
    v_items = v_items_result.scalars().all()

    ci_map = {}
    for sec, items in filtered_sections:
        for item in items:
            ci_map[item.id] = (sec, item)

    # Build response preserving template order
    items_out = []
    item_by_ci = {}
    for v_item in v_items:
        if v_item.checklist_item_id in ci_map:
            item_by_ci[v_item.checklist_item_id] = v_item
            if not v_item.checklist_item:
                v_item.checklist_item = ci_map[v_item.checklist_item_id][1]

    for sec, items in filtered_sections:
        for item in sorted(items, key=lambda i: i.sort_order):
            v_item = item_by_ci.get(item.id)
            if v_item is None:
                continue
            items_out.append(v_item)

    # Map each per-visit item to its template section name (for grouped UI)
    section_names = {s.id: s.name for s in template.sections}
    item_section_name = {}
    for v_item in items_out:
        sec = ci_map.get(v_item.checklist_item_id)
        if sec is not None:
            item_section_name[v_item.id] = section_names.get(sec[0].id)

    completed = sum(1 for i in items_out if i.is_completed)
    total = len(items_out)

    raz = ChecklistResponse(
        visit_id=visit.id,
        template={
            "id": template.id,
            "name": template.name,
            "version": template.version,
            "sections": [
                {
                    "id": s.id,
                    "name": s.name,
                    "sort_order": s.sort_order,
                }
                for s in template.sections
            ],
        },
        items=[
            _serialize_v_item(i, item_section_name.get(i.id))
            for i in items_out
        ],
        progress=round(completed / total * 100, 1) if total else 0.0,
        completed_count=completed,
        total_count=total,
    )
    return raz


def _serialize_v_item(v_item: VisitChecklistItem, section_name: str | None = None):
    item = v_item.checklist_item
    return {
        "id": v_item.id,
        "section_name": section_name,
        "visit_id": v_item.visit_id,
        "checklist_item_id": v_item.checklist_item_id,
        "status": v_item.status,
        "response_value": v_item.response_value,
        "remark": v_item.remark,
        "observation": v_item.observation,
        "action_required": v_item.action_required,
        "responsible_person_id": v_item.responsible_person_id,
        "target_date": v_item.target_date,
        "is_completed": v_item.is_completed,
        "item_name": item.name if item else None,
        "item_description": item.description if item else None,
        "response_type": item.response_type if item else "STATUS",
        "options": item.options if item else ["OK", "NOT_OK", "NA"],
        "photo_allowed": item.photo_allowed if item else True,
        "photo_required_on": item.photo_required_on if item else [],
        "remark_required_on": item.remark_required_on if item else [],
        "action_required_on": item.action_required_on if item else [],
        "responsible_required_on": item.responsible_required_on if item else [],
        "target_date_required_on": item.target_date_required_on if item else [],
        "role_tags": (item.role_tags if item else []) or [],
        "sample_refs": (item.sample_refs if item else []) or [],
    }


@router.patch("/{visit_id}/checklist/items/{item_id}", response_model=dict)
async def update_checklist_item(
    visit_id: UUID,
    item_id: UUID,
    payload: VisitChecklistItemUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit)
        .options(selectinload(Visit.assignments), selectinload(Visit.branch))
        .where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    assignment_ids = {a.user_id for a in visit.assignments if a.assignment_type == "VISITOR"}
    if not _can_respond(current_user, visit, assignment_ids):
        raise HTTPException(status_code=403, detail="Not authorized to modify this visit's checklist")

    if visit.status not in ("DRAFT", "ASSIGNED", "SCHEDULED", "IN_PROGRESS", "REWORK_REQUIRED", "RESUBMITTED", "REJECTED"):
        raise HTTPException(status_code=409, detail=f"Cannot modify checklist in status {visit.status}")

    item_result = await db.execute(
        select(VisitChecklistItem)
        .options(selectinload(VisitChecklistItem.checklist_item))
        .where(VisitChecklistItem.id == item_id, VisitChecklistItem.visit_id == visit_id)
    )
    v_item = item_result.scalar_one_or_none()
    if not v_item:
        raise HTTPException(status_code=404, detail="Checklist item not found for this visit")

    data = payload.model_dump(exclude_unset=True)
    old_status = v_item.status

    for key, value in data.items():
        setattr(v_item, key, value)

    # Determine completeness based on config requirements
    ci = v_item.checklist_item
    if v_item.status is not None:
        req_failures = []
        if v_item.status in (ci.remark_required_on or []):
            if not (v_item.remark or "").strip():
                req_failures.append("remark")
        if v_item.status in (ci.action_required_on or []):
            if not (v_item.action_required or "").strip():
                req_failures.append("action_required")
        if v_item.status in (ci.responsible_required_on or []):
            if not v_item.responsible_person_id:
                v_item.responsible_person_id = current_user.id
        if v_item.status in (ci.target_date_required_on or []):
            if not v_item.target_date:
                from datetime import date, timedelta
                v_item.target_date = date.today() + timedelta(days=7)
        if req_failures:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required fields: {', '.join(req_failures)}",
            )
        v_item.is_completed = True

        # Auto-raise a corrective action for NOT OK items with an action —
        # this is what feeds the admin console's Corrective Actions page.
        if v_item.status == "NOT_OK" and (v_item.action_required or "").strip():
            from models.action import CorrectiveAction
            from datetime import date, timedelta
            # Uses v_item.id (the per-visit item) consistently on both the
            # dedup lookup and the stored row — previously the lookup used the
            # template item id, so re-saving kept creating duplicate actions.
            existing = await db.execute(
                select(CorrectiveAction).where(
                    CorrectiveAction.visit_id == visit_id,
                    CorrectiveAction.checklist_item_id == v_item.id,
                    CorrectiveAction.status.in_(["OPEN", "IN_PROGRESS"]),
                )
            )
            if existing.scalars().first() is None:
                db.add(CorrectiveAction(
                    visit_id=visit_id,
                    checklist_item_id=v_item.id,
                    title=f"{ci.name[:120]} — fix required",
                    description=(v_item.observation or None),
                    observation=(v_item.observation or None),
                    action_required=(v_item.action_required or None),
                    responsible_person_id=v_item.responsible_person_id or current_user.id,
                    target_date=v_item.target_date or (date.today() + timedelta(days=7)),
                    priority="HIGH",
                    status="OPEN",
                    created_by=current_user.id,
                ))
                await db.flush()
                if (v_item.responsible_person_id or current_user.id) != current_user.id:
                    audit_utils.create_notification(
                        db, user_id=v_item.responsible_person_id,
                        title="Corrective Action Assigned",
                        body=f"{ci.name[:150]} — {v_item.action_required[:150]}",
                        notif_type="ACTION_ASSIGNED", entity_type="visit", entity_id=visit.id,
                    )
        # If the item moved AWAY from NOT_OK, close any open action raised for it.
        elif old_status == "NOT_OK" and v_item.status in ("OK", "NA"):
            from models.action import CorrectiveAction
            opens = await db.execute(
                select(CorrectiveAction).where(
                    CorrectiveAction.visit_id == visit_id,
                    CorrectiveAction.checklist_item_id == v_item.id,
                    CorrectiveAction.status.in_(["OPEN", "IN_PROGRESS"]),
                )
            )
            for act in opens.scalars().all():
                act.status = "CLOSED"
                act.updated_by = current_user.id

    v_item.updated_by = current_user.id
    await AuditLogger.log(db, user_id=current_user.id,
                          action="RESPONSE_MODIFIED", entity_type="visit", entity_id=visit.id,
                          details={"item": str(item_id), "old_status": old_status, "new_status": v_item.status})
    return {"message": "Item updated", "is_completed": v_item.is_completed}


@router.post("/{visit_id}/checklist/mark-all-ok", response_model=dict)
async def mark_remaining_ok(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Visit)
        .options(selectinload(Visit.assignments), selectinload(Visit.branch))
        .where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    assignment_ids = {a.user_id for a in visit.assignments if a.assignment_type == "VISITOR"}
    if not _can_respond(current_user, visit, assignment_ids):
        raise HTTPException(status_code=403, detail="Not authorized")

    result = await db.execute(
        select(VisitChecklistItem)
        .options(selectinload(VisitChecklistItem.checklist_item))
        .where(
            VisitChecklistItem.visit_id == visit_id,
            VisitChecklistItem.status.is_(None),
            VisitChecklistItem.is_completed.is_(False),
        )
    )
    updated = 0
    for v_item in result.scalars().all():
        v_item.status = "OK"
        v_item.is_completed = True
        v_item.updated_by = current_user.id
        updated += 1

    if updated:
        await AuditLogger.log(db, user_id=current_user.id,
                              action="CHECKLIST_MARK_ALL_OK", entity_type="visit", entity_id=visit.id,
                              details={"count": updated})
    return {"message": f"Marked {updated} remaining items as OK"}