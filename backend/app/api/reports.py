import io
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission, can_access_branch
from models.visit import Visit, VisitChecklistItem, VisitAssignment
from models.checklist import ChecklistTemplate, ChecklistSection, ChecklistItem
from models.action import CorrectiveAction
from models.photo import Photo
from models.misc import AuditLog
from utils.storage import get_presigned_url, is_postgres_mode, backend_name

router = APIRouter(tags=["reports"])


async def _load_visit_report_data(db: AsyncSession, visit_id: UUID) -> dict:
    result = await db.execute(
        select(Visit)
        .options(
            selectinload(Visit.branch),
            selectinload(Visit.visit_type),
            selectinload(Visit.template),
            selectinload(Visit.assignments).selectinload(VisitAssignment.user),
        )
        .where(Visit.id == visit_id)
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    items_result = await db.execute(
        select(VisitChecklistItem)
        .options(selectinload(VisitChecklistItem.checklist_item))
        .where(VisitChecklistItem.visit_id == visit_id)
        .order_by(VisitChecklistItem.created_at)
    )
    items = items_result.scalars().all()

    actions_result = await db.execute(
        select(CorrectiveAction)
        .options(selectinload(CorrectiveAction.responsible_person))
        .where(CorrectiveAction.visit_id == visit_id)
        .order_by(CorrectiveAction.created_at)
    )
    actions = actions_result.scalars().all()

    photos_result = await db.execute(
        select(Photo).where(Photo.visit_id == visit_id).order_by(Photo.created_at)
    )
    photos = photos_result.scalars().all()

    reviews_result = await db.execute(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "visit",
            AuditLog.entity_id == str(visit_id),
            AuditLog.action.in_(["VISIT_SUBMITTED", "VISIT_APPROVED", "VISIT_REJECTED"]),
        )
        .order_by(AuditLog.created_at)
    )
    review_events = reviews_result.scalars().all()

    sections_map = {}
    if visit.template_id:
        t_result = await db.execute(
            select(ChecklistTemplate)
            .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
            .where(ChecklistTemplate.id == visit.template_id)
        )
        template = t_result.scalar_one_or_none()
        if template:
            for sec in template.sections:
                sections_map[sec.id] = sec

    # Group items by section keeping template order
    grouped = []
    if visit.template_id and sections_map:
        for sec in sections_map.values():
            sec_items = [
                i for i in items
                if i.checklist_item and i.checklist_item.section_id == sec.id
            ]
            sec_items.sort(key=lambda i: i.checklist_item.sort_order)
            grouped.append({"section": sec.name, "items": sec_items})
    else:
        grouped = [{"section": "Checklist", "items": items}]

    ok = sum(1 for i in items if i.status == "OK")
    notok = sum(1 for i in items if i.status == "NOT_OK")
    na = sum(1 for i in items if i.status == "NA")

    return {
        "visit": visit,
        "items": items,
        "actions": actions,
        "photos": photos,
        "grouped": grouped,
        "ok": ok,
        "not_ok": notok,
        "na": na,
        "review_events": review_events,
    }


@router.get("/reports/visits/{visit_id}")
async def visit_report(
    visit_id: UUID,
    current_user=Depends(require_permission(Permission.VIEW_REPORT)),
    db: AsyncSession = Depends(get_db),
):
    """Returns the full structured report data as JSON (used by web + PDF rendering)."""
    data = await _load_visit_report_data(db, visit_id)
    visit = data["visit"]

    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    items = data["items"]
    return {
        "visit": {
            "id": str(visit.id),
            "status": visit.status,
            "priority": visit.priority,
            "scheduled_date": visit.scheduled_date.isoformat() if visit.scheduled_date else None,
            "started_at": visit.started_at.isoformat() if visit.started_at else None,
            "submitted_at": visit.submitted_at.isoformat() if visit.submitted_at else None,
            "completed_at": visit.completed_at.isoformat() if visit.completed_at else None,
            "instructions": visit.instructions,
            "visitor_notes": visit.visitor_notes,
            "compliance_percentage": visit.compliance_percentage,
        },
        "branch": {
            "name": visit.branch.name if visit.branch else None,
            "code": visit.branch.code if visit.branch else None,
            "address": visit.branch.address if visit.branch else None,
            "city": visit.branch.city if visit.branch else None,
            "state": visit.branch.state if visit.branch else None,
        },
        "visit_type": visit.visit_type.name if visit.visit_type else None,
        "template": visit.template.name if visit.template else None,
        "visitors": [
            {"name": a.user.full_name, "email": a.user.email}
            for a in visit.assignments if a.assignment_type == "VISITOR"
        ],
        "reviewers": [
            {"name": a.user.full_name, "email": a.user.email}
            for a in visit.assignments if a.assignment_type == "REVIEWER"
        ],
        "summary": {
            "ok": data["ok"],
            "not_ok": data["not_ok"],
            "na": data["na"],
            "total": len(items),
            "compliance_percentage": visit.compliance_percentage,
        },
        "sections": [
            {
                "name": group["section"],
                "items": [
                    {
                        "name": i.checklist_item.name if i.checklist_item else "Item",
                        "status": i.status,
                        "remark": i.remark,
                        "observation": i.observation,
                        "action_required": i.action_required,
                        "responsible_person": i.responsible_person.full_name if i.responsible_person else None,
                        "target_date": i.target_date.isoformat() if i.target_date else None,
                    }
                    for i in group["items"]
                ],
            }
            for group in data["grouped"]
        ],
        "actions": [
            {
                "title": a.title,
                "action_required": a.action_required,
                "status": a.status,
                "priority": a.priority,
                "responsible_person": a.responsible_person.full_name if a.responsible_person else None,
                "target_date": a.target_date.isoformat() if a.target_date else None,
                "closed_at": a.closed_at.isoformat() if a.closed_at else None,
            }
            for a in data["actions"]
        ],
        "photos": [
            {
                "id": str(p.id),
                "url": (
                    f"/api/v1/photos/{p.id}/file"
                    if is_postgres_mode() or backend_name() == "local"
                    else (get_presigned_url(p.storage_path) if p.storage_path else None)
                ),
                "caption": p.caption,
                "captured_at": p.captured_at.isoformat() if p.captured_at else None,
                "status": None,
            }
            for p in data["photos"]
        ],
        "review_events": [
            {
                "action": e.action,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in data["review_events"]
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/reports/visits/{visit_id}/export")
async def export_visit_report(
    visit_id: UUID,
    current_user=Depends(require_permission(Permission.EXPORT_REPORT)),
    db: AsyncSession = Depends(get_db),
):
    """Exports visit report as a UTF-8 CSV file (via the JSON structure)."""

    async def _build_csv_rows() -> str:
        data = await _load_visit_report_data(db, visit_id)
        visit = data["visit"]
        lines = []
        lines.append("Branch Visit Report")
        lines.append(f"Branch,{visit.branch.name if visit.branch else ''}")
        lines.append(f"Branch Code,{visit.branch.code if visit.branch else ''}")
        lines.append(f"Visit Type,{visit.visit_type.name if visit.visit_type else ''}")
        lines.append(f"Status,{visit.status}")
        lines.append(f"Compliance %,{visit.compliance_percentage if visit.compliance_percentage is not None else ''}")
        lines.append("")
        lines.append("Section,Item,Status,Remark,Observation,Action Required,Responsible,Target Date")
        for group in data["grouped"]:
            for i in group["items"]:
                def _cell(v):
                    if v is None:
                        return ""
                    return str(v).replace("\n", " ").replace(",", ";")
                lines.append(",".join(_cell(x) for x in [
                    group["section"],
                    i.checklist_item.name if i.checklist_item else "",
                    i.status,
                    i.remark,
                    i.observation,
                    i.action_required,
                    i.responsible_person.full_name if i.responsible_person else "",
                    i.target_date,
                ]))
        lines.append("")
        lines.append("Corrective Actions")
        lines.append("Title,Status,Priority,Responsible,Target Date,Action Required")
        for a in data["actions"]:
            lines.append(",".join(_cell(x) for x in [
                a.title, a.status, a.priority,
                a.responsible_person.full_name if a.responsible_person else "",
                a.target_date, a.action_required,
            ]))
        return "\n".join(lines)

    content = await _build_csv_rows()
    filename = f"visit-report-{str(visit_id)[:8]}.csv"
    return StreamingResponse(
        io.StringIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )