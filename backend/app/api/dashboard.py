from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission, get_current_user, branch_scope_filter
from models.visit import Visit, VisitChecklistItem
from models.action import CorrectiveAction
from models.org import Branch, Region
from models.checklist import ChecklistTemplate, ChecklistSection, ChecklistItem
from models.misc import AuditLog, Notification
from models.user import User
from schemas.dashboard import DashboardData, DashboardCard, ChartPoint
from schemas.visit import VisitWithDetails

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/branch-overview")
async def branch_overview(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-branch drill-down for the dashboard Branches card:
    visits count, per-role checklist coverage, compliance."""
    from models.org import Branch as BranchModel, Region, Area
    from models.checklist import ChecklistItem

    scope = branch_scope_filter(current_user)
    branch_stmt = (
        select(BranchModel)
        .options(selectinload(BranchModel.area).selectinload(Area.region))
        .where(BranchModel.is_active.is_(True))
    )
    if scope is not None:
        branch_stmt = branch_stmt.where(scope)
    branches = (await db.execute(branch_stmt)).scalars().all()

    visit_counts = dict(
        (await db.execute(
            select(Visit.branch_id, func.count(Visit.id)).group_by(Visit.branch_id)
        )).all()
    )
    in_prog = dict(
        (await db.execute(
            select(Visit.branch_id, func.count(Visit.id))
            .where(Visit.status.in_(["DRAFT", "ASSIGNED", "SCHEDULED", "IN_PROGRESS", "REWORK_REQUIRED", "RESUBMITTED"]))
            .group_by(Visit.branch_id)
        )).all()
    )
    submitted = dict(
        (await db.execute(
            select(Visit.branch_id, func.count(Visit.id))
            .where(Visit.status.in_(["SUBMITTED", "UNDER_REVIEW"]))
            .group_by(Visit.branch_id)
        )).all()
    )
    done = dict(
        (await db.execute(
            select(Visit.branch_id, func.count(Visit.id))
            .where(Visit.status.in_(["APPROVED", "CLOSED"]))
            .group_by(Visit.branch_id)
        )).all()
    )
    avg_comp = dict(
        (await db.execute(
            select(Visit.branch_id, func.avg(Visit.compliance_percentage))
            .where(Visit.compliance_percentage.isnot(None))
            .group_by(Visit.branch_id)
        )).all()
    )
    # Role coverage: which role tags exist across each branch's active template items.
    # (No SQL DISTINCT — the role_tags JSON column has no equality operator;
    # deduplicate in Python instead.)
    role_rows = (await db.execute(
        select(BranchModel.id, ChecklistItem.role_tags)
        .join(Visit, Visit.branch_id == BranchModel.id)
        .join(ChecklistTemplate, ChecklistTemplate.id == Visit.template_id)
        .join(ChecklistSection, ChecklistSection.template_id == ChecklistTemplate.id)
        .join(ChecklistItem, ChecklistItem.section_id == ChecklistSection.id)
        .where(ChecklistItem.is_active.is_(True))
    )).all()
    role_map = {}
    for bid, tags in role_rows:
        s = role_map.setdefault(bid, set())
        if not tags:
            s.update({"ADMIN", "HR", "OPS", "OTHERS"})
        else:
            s.update(tags)

    out = []
    for b in branches:
        region_name = b.area.region.name if b.area and b.area.region else None
        out.append({
            "id": str(b.id),
            "name": b.name,
            "code": b.code,
            "city": b.city,
            "region": region_name,
            "total_visits": int(visit_counts.get(b.id, 0)),
            "in_progress": int(in_prog.get(b.id, 0)),
            "submitted": int(submitted.get(b.id, 0)),
            "completed": int(done.get(b.id, 0)),
            "compliance": round(float(avg_comp[b.id]), 1) if b.id in avg_comp and avg_comp[b.id] is not None else None,
            "roles": sorted(role_map.get(b.id, set())),
        })
    out.sort(key=lambda x: -x["total_visits"])
    return out


@router.get("/dashboard/mobile-summary")
async def mobile_summary(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compact stat block for the mobile home screen:
    total branches, total visits, completed and pending visits —
    scoped to the user's branch visibility (HR / Admin / HOD etc.).
    Completed counts visits in an accepted/finished state.
    """
    scope = branch_scope_filter(current_user)

    branch_stmt = select(func.count(Branch.id))
    if scope is not None:
        branch_stmt = branch_stmt.where(scope)
    total_branches = (await db.execute(branch_stmt)).scalar() or 0

    visit_stmt = select(func.count(Visit.id))
    if scope is not None:
        visit_stmt = visit_stmt.where(
            Visit.branch_id.in_(select(Branch.id).where(scope))
        )
    total_visits = (await db.execute(visit_stmt)).scalar() or 0

    completed_stmt = visit_stmt.where(Visit.status.in_(("APPROVED", "CLOSED", "CANCELLED")))
    completed_visits = (await db.execute(completed_stmt)).scalar() or 0

    return {
        "total_branches": total_branches,
        "total_checklists": total_visits,
        "completed_checklists": completed_visits,
        "pending_checklists": max(total_visits - completed_visits, 0),
    }


@router.get("/dashboard", response_model=DashboardData)
async def dashboard(
    current_user=Depends(require_permission(Permission.VIEW_DASHBOARD)),
    db: AsyncSession = Depends(get_db),
):
    scope = branch_scope_filter(current_user)

    base = select(Visit)
    if scope is not None:
        base = base.where(Visit.branch_id.in_(select(Branch.id).where(scope)))

    # ---- Query all statuses via group by
    count_stmt = select(Visit.status, func.count(Visit.id)).group_by(Visit.status)
    if scope is not None:
        count_stmt = count_stmt.where(Visit.branch_id.in_(select(Branch.id).where(scope)))
    count_result = await db.execute(count_stmt)
    status_counts = {s: c for s, c in count_result.all()}

    branch_count_stmt = select(func.count(Branch.id))
    if scope is not None:
        branch_count_stmt = branch_count_stmt.where(scope)
    total_branches = (await db.execute(branch_count_stmt)).scalar() or 0

    total_visits = sum(status_counts.values())

    # Simple 3-bucket model: a visit is either being worked on, submitted, or done.
    # Legacy states (DRAFT/ASSIGNED/SCHEDULED/REJECTED/REWORK_REQUIRED/…) fold into
    # the bucket they actually behave as, so no card ever shows a state this app
    # doesn't really use.
    in_progress = sum(
        status_counts.get(s, 0)
        for s in ("DRAFT", "ASSIGNED", "SCHEDULED", "IN_PROGRESS", "REWORK_REQUIRED", "RESUBMITTED")
    )
    submitted = status_counts.get("SUBMITTED", 0) + status_counts.get("UNDER_REVIEW", 0)
    all_done = (
        status_counts.get("APPROVED", 0)
        + status_counts.get("CLOSED", 0)
        + status_counts.get("REJECTED", 0)
        + status_counts.get("CANCELLED", 0)
    )

    cards = [
        DashboardCard(key="total_visits", label="Total Visits", value=total_visits),
        DashboardCard(key="in_progress", label="In Progress", value=in_progress),
        DashboardCard(key="submitted", label="Submitted", value=submitted),
        DashboardCard(key="all_done", label="Completed", value=all_done),
    ]

    # Visits by region
    region_stmt = (
        select(Region.name, func.count(Visit.id))
        .join(Branch, Branch.region_id == Region.id)
        .join(Visit, Visit.branch_id == Branch.id)
        .group_by(Region.name)
    )
    if scope is not None:
        region_stmt = region_stmt.where(scope)
    visits_by_region = [ChartPoint(label=r, value=c) for r, c in (await db.execute(region_stmt)).all()]

    # Visits by branch (top 10)
    branch_stmt = (
        select(Branch.name, func.count(Visit.id))
        .join(Visit, Visit.branch_id == Branch.id)
        .group_by(Branch.name)
        .order_by(func.count(Visit.id).desc())
        .limit(10)
    )
    if scope is not None:
        branch_stmt = branch_stmt.where(scope)
    visits_by_branch = [ChartPoint(label=b, value=c) for b, c in (await db.execute(branch_stmt)).all()]

    # Compliance by region
    compliance_stmt = (
        select(Region.name, func.avg(Visit.compliance_percentage))
        .join(Branch, Branch.region_id == Region.id)
        .join(Visit, Visit.branch_id == Branch.id)
        .where(Visit.compliance_percentage.isnot(None))
        .group_by(Region.name)
    )
    if scope is not None:
        compliance_stmt = compliance_stmt.where(scope)
    compliance_by_region = [
        ChartPoint(label=r, value=round(float(c), 1) if c else 0)
        for r, c in (await db.execute(compliance_stmt)).all()
    ]

    # Failed categories: sections with NOT_OK counts using item->section mapping
    failed_stmt = (
        select(VisitChecklistItem.checklist_item_id, func.count(VisitChecklistItem.id))
        .where(VisitChecklistItem.status == "NOT_OK")
        .group_by(VisitChecklistItem.checklist_item_id)
    )
    if scope is not None:
        failed_stmt = failed_stmt.where(
            VisitChecklistItem.visit_id.in_(select(Visit.id).where(Visit.branch_id.in_(select(Branch.id).where(scope))))
        )
    failed_result = await db.execute(failed_stmt)
    failed_items = dict(failed_result.all())

    section_names = {}
    if failed_items:
        from models.checklist import ChecklistItem, ChecklistSection
        sec_result = await db.execute(
            select(
                ChecklistSection.name,
                ChecklistSection.id,
            )
            .join(ChecklistItem, ChecklistItem.section_id == ChecklistSection.id)
            .where(ChecklistItem.id.in_(failed_items.keys()))
        )
        item_section = {}
        item_result = await db.execute(
            select(ChecklistItem.id, ChecklistItem.section_id).where(ChecklistItem.id.in_(failed_items.keys()))
        )
        for iid, sid in item_result.all():
            item_section[iid] = sid
        sections_result = await db.execute(select(ChecklistSection))
        sec_name = {s.id: s.name for s in sections_result.scalars().all()}

        agg = {}
        for iid, cnt in failed_items.items():
            sid = item_section.get(iid)
            agg[sec_name.get(sid, "Uncategorized")] = agg.get(sec_name.get(sid, "Uncategorized"), 0) + cnt
        failed_categories = [ChartPoint(label=k, value=v) for k, v in sorted(agg.items(), key=lambda x: -x[1])]
    else:
        failed_categories = []

    # Open & overdue actions by priority
    open_actions_stmt = (
        select(CorrectiveAction.priority, func.count(CorrectiveAction.id))
        .where(CorrectiveAction.status.in_(["OPEN", "IN_PROGRESS", "OVERDUE"]))
        .group_by(CorrectiveAction.priority)
    )
    if scope is not None:
        open_actions_stmt = open_actions_stmt.where(
            CorrectiveAction.visit_id.in_(select(Visit.id).where(Visit.branch_id.in_(select(Branch.id).where(scope))))
        )
    open_actions_list = (await db.execute(open_actions_stmt)).all()
    open_action_points = [ChartPoint(label=p, value=c) for p, c in open_actions_list]

    overdue_stmt = (
        select(CorrectiveAction.priority, func.count(CorrectiveAction.id))
        .where(
            CorrectiveAction.status.in_(["OPEN", "IN_PROGRESS", "VERIFICATION_PENDING"]),
            CorrectiveAction.target_date < func.current_date(),
        )
        .group_by(CorrectiveAction.priority)
    )
    if scope is not None:
        overdue_stmt = overdue_stmt.where(
            CorrectiveAction.visit_id.in_(select(Visit.id).where(Visit.branch_id.in_(select(Branch.id).where(scope))))
        )
    overdue_list = (await db.execute(overdue_stmt)).all()
    overdue_points = [ChartPoint(label=p, value=c) for p, c in overdue_list]

    # Recent visits
    recent_stmt = (
        select(Visit)
        .options(selectinload(Visit.branch), selectinload(Visit.visit_type))
        .order_by(Visit.created_at.desc())
        .limit(8)
    )
    if scope is not None:
        recent_stmt = recent_stmt.where(Visit.branch_id.in_(select(Branch.id).where(scope)))
    recent_visits = []
    for v in (await db.execute(recent_stmt)).scalars().all():
        recent_visits.append({
            "id": str(v.id),
            "branch": v.branch.name if v.branch else None,
            "visit_type": v.visit_type.name if v.visit_type else None,
            "status": v.status,
            "scheduled_date": v.scheduled_date.isoformat() if v.scheduled_date else None,
            "compliance_percentage": v.compliance_percentage,
        })

    return DashboardData(
        cards=cards,
        visits_by_region=visits_by_region,
        visits_by_branch=visits_by_branch,
        compliance_by_region=compliance_by_region,
        failed_categories=failed_categories,
        open_actions=open_action_points,
        overdue_actions=overdue_points,
        recent_visits=recent_visits,
    )


@router.get("/dashboard/notifications")
async def my_notifications(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    return [
        {
            "id": str(n.id),
            "title": n.title,
            "body": n.body,
            "type": n.type,
            "entity_type": n.entity_type,
            "entity_id": n.entity_id,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in result.scalars().all()
    ]


@router.post("/dashboard/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    n = result.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    return {"message": "Marked as read"}


@router.get("/dashboard/audit-logs")
async def audit_logs(
    limit: int = 100,
    current_user=Depends(require_permission(Permission.VIEW_AUDIT_LOG)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    )
    logs = result.scalars().all()
    # Resolve user names in one extra query (AuditLog has no user relationship).
    user_ids = {l.user_id for l in logs if l.user_id}
    names: dict = {}
    if user_ids:
        ures = await db.execute(select(User).where(User.id.in_(user_ids)))
        names = {u.id: u.full_name for u in ures.scalars().all()}
    return [
        {
            "id": str(l.id),
            "user": names.get(l.user_id),
            "action": l.action,
            "entity_type": l.entity_type,
            "entity_id": l.entity_id,
            "details": l.details,
            "ip_address": l.ip_address,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


@router.get("/dashboard/live-field-activity")
async def live_field_activity(
    current_user=Depends(require_permission(Permission.VIEW_DASHBOARD)),
    db: AsyncSession = Depends(get_db),
):
    """Real-time monitoring of mobile field operations:
    - Active mobile visits currently in progress or recently updated
    - Inspector progress (questions answered, photos captured, IT assets verified)
    - Live mobile activity feed from audit logs
    - Field operations KPI counters
    """
    from models.asset import VisitAsset, VisitItAsset
    from models.photo import Photo
    from models.org import Area, Branch
    from models.visit import VisitAssignment

    scope = branch_scope_filter(current_user)

    # 1. Fetch active / recent visits with branch & assignments
    visit_stmt = (
        select(Visit)
        .options(
            selectinload(Visit.branch).selectinload(Branch.area).selectinload(Area.region),
            selectinload(Visit.assignments).selectinload(VisitAssignment.user),
            selectinload(Visit.visit_type),
        )
        .order_by(Visit.updated_at.desc(), Visit.created_at.desc())
        .limit(20)
    )
    if scope is not None:
        visit_stmt = visit_stmt.where(Visit.branch_id.in_(select(Branch.id).where(scope)))

    visits_list = (await db.execute(visit_stmt)).scalars().all()
    visit_ids = [v.id for v in visits_list]

    item_stats = {}
    if visit_ids:
        rows = (
            await db.execute(
                select(
                    VisitChecklistItem.visit_id,
                    func.count(VisitChecklistItem.id).label("total"),
                    func.count(func.nullif(VisitChecklistItem.status, None)).label("answered"),
                )
                .where(VisitChecklistItem.visit_id.in_(visit_ids))
                .group_by(VisitChecklistItem.visit_id)
            )
        ).all()
        for vid, tot, ans in rows:
            item_stats[vid] = {"total": tot, "answered": ans}

    photo_counts = {}
    if visit_ids:
        p_rows = (
            await db.execute(
                select(Photo.visit_id, func.count(Photo.id))
                .where(Photo.visit_id.in_(visit_ids))
                .group_by(Photo.visit_id)
            )
        ).all()
        for vid, cnt in p_rows:
            photo_counts[vid] = cnt

    it_asset_counts = {}
    if visit_ids:
        it_rows = (
            await db.execute(
                select(
                    VisitItAsset.visit_id,
                    func.count(VisitItAsset.id).label("total"),
                    func.count(func.nullif(VisitItAsset.code, None)).label("verified"),
                )
                .where(VisitItAsset.visit_id.in_(visit_ids))
                .group_by(VisitItAsset.visit_id)
            )
        ).all()
        for vid, tot, ver in it_rows:
            it_asset_counts[vid] = {"total": tot, "verified": ver}

    fixed_asset_counts = {}
    if visit_ids:
        fa_rows = (
            await db.execute(
                select(VisitAsset.visit_id, func.count(VisitAsset.id))
                .where(VisitAsset.visit_id.in_(visit_ids))
                .group_by(VisitAsset.visit_id)
            )
        ).all()
        for vid, cnt in fa_rows:
            fixed_asset_counts[vid] = cnt

    active_visits = []
    for v in visits_list:
        visitors = [a.user.full_name for a in v.assignments if a.assignment_type == "VISITOR" and a.user]
        visitor_emails = [a.user.email for a in v.assignments if a.assignment_type == "VISITOR" and a.user]
        lead_visitor = visitors[0] if visitors else (v.visitor_notes or "Field Inspector")
        region_name = v.branch.area.region.name if v.branch and v.branch.area and v.branch.area.region else None

        istat = item_stats.get(v.id, {"total": 0, "answered": 0})
        ans = istat["answered"]
        tot = istat["total"]
        pct = round((ans / tot) * 100) if tot > 0 else (100 if v.status in ("SUBMITTED", "APPROVED", "CLOSED") else 0)

        itstat = it_asset_counts.get(v.id, {"total": 0, "verified": 0})
        photos_num = photo_counts.get(v.id, 0)
        fixed_num = fixed_asset_counts.get(v.id, 0)

        active_visits.append({
            "id": str(v.id),
            "branch_id": str(v.branch_id) if v.branch_id else None,
            "branch_name": v.branch.name if v.branch else "—",
            "branch_code": v.branch.code if v.branch else "—",
            "city": v.branch.city if v.branch else None,
            "region": region_name,
            "inspector_name": lead_visitor,
            "inspector_email": visitor_emails[0] if visitor_emails else None,
            "status": v.status,
            "priority": v.priority,
            "started_at": v.started_at.isoformat() if v.started_at else None,
            "updated_at": v.updated_at.isoformat() if v.updated_at else None,
            "scheduled_date": v.scheduled_date.isoformat() if v.scheduled_date else None,
            "checklist_total": tot,
            "checklist_answered": ans,
            "checklist_progress_pct": pct,
            "photos_count": photos_num,
            "fixed_assets_count": fixed_num,
            "it_assets_total": itstat["total"],
            "it_assets_verified": itstat["verified"],
            "compliance_percentage": v.compliance_percentage,
        })

    # 2. Live Activity Feed from AuditLogs
    log_stmt = (
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .limit(20)
    )
    logs = (await db.execute(log_stmt)).scalars().all()
    user_ids = {l.user_id for l in logs if l.user_id}
    names = {}
    if user_ids:
        ures = await db.execute(select(User).where(User.id.in_(user_ids)))
        names = {u.id: u.full_name for u in ures.scalars().all()}

    activity_feed = [
        {
            "id": str(l.id),
            "user_name": names.get(l.user_id, "System / Mobile User"),
            "action": l.action,
            "entity_type": l.entity_type,
            "entity_id": str(l.entity_id) if l.entity_id else None,
            "details": l.details,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]

    in_prog_count = sum(1 for v in active_visits if v["status"] in ("IN_PROGRESS", "DRAFT", "ASSIGNED", "SCHEDULED", "REWORK_REQUIRED", "RESUBMITTED"))
    submitted_count = sum(1 for v in active_visits if v["status"] in ("SUBMITTED", "UNDER_REVIEW"))
    total_photos_active = sum(v["photos_count"] for v in active_visits)
    total_it_verified = sum(v["it_assets_verified"] for v in active_visits)

    return {
        "active_visits": active_visits,
        "activity_feed": activity_feed,
        "summary": {
            "in_progress_count": in_prog_count,
            "submitted_for_review": submitted_count,
            "total_photos_evidence": total_photos_active,
            "total_it_assets_verified": total_it_verified,
        }
    }