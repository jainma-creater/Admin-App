from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission, get_current_user
from models.visit import Visit, VisitChecklistItem
from models.action import CorrectiveAction, ActionEvidence
from schemas.action import (
    CorrectiveActionCreate,
    CorrectiveActionUpdate,
    CorrectiveActionWithDetails,
)
from utils.audit import AuditLogger, is_overdue
from utils import audit as audit_utils

router = APIRouter(tags=["actions"])


async def _serialize(db, action: CorrectiveAction) -> CorrectiveActionWithDetails:
    item = CorrectiveActionWithDetails.model_validate(action, from_attributes=True)
    if action.responsible_person:
        item.responsible_person_name = action.responsible_person.full_name
        item.responsible_person_email = action.responsible_person.email
    if action.visit and action.visit.branch:
        item.branch_name = action.visit.branch.name
    item.is_overdue = is_overdue(action.status, action.target_date)
    return item


def _with_details(stmt):
    return stmt.options(
        selectinload(CorrectiveAction.responsible_person),
        selectinload(CorrectiveAction.visit).selectinload(Visit.branch),
    )


@router.get("/actions", response_model=list[CorrectiveActionWithDetails])
async def list_actions(
    limit: int = Query(50, ge=1, le=200),
    status_filter: str | None = Query(None, alias="status"),
    branch_id: UUID | None = None,
    current_user=Depends(require_permission(Permission.READ_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    stmt = _with_details(
        select(CorrectiveAction).order_by(CorrectiveAction.created_at.desc()).limit(limit)
    )
    if status_filter:
        stmt = stmt.where(CorrectiveAction.status == status_filter)
    if branch_id:
        stmt = stmt.where(CorrectiveAction.visit.has(Visit.branch_id == branch_id))
    result = await db.execute(stmt)
    out = []
    for a in result.scalars().all():
        out.append(await _serialize(db, a))
    return out


@router.get("/actions/overdue", response_model=list[CorrectiveActionWithDetails])
async def list_overdue_actions(
    current_user=Depends(require_permission(Permission.READ_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        _with_details(
            select(CorrectiveAction)
            .where(
                CorrectiveAction.status.in_(["OPEN", "IN_PROGRESS", "VERIFICATION_PENDING"]),
                CorrectiveAction.target_date < func.current_date(),
            )
            .order_by(CorrectiveAction.target_date)
        )
    )
    out = []
    for a in result.scalars().all():
        out.append(await _serialize(db, a))
    return out


@router.get("/actions/assigned-to-me", response_model=list[CorrectiveActionWithDetails])
async def my_actions(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        _with_details(
            select(CorrectiveAction)
            .where(CorrectiveAction.responsible_person_id == current_user.id)
            .order_by(CorrectiveAction.target_date)
        )
    )
    out = []
    for a in result.scalars().all():
        out.append(await _serialize(db, a))
    return out


@router.get("/visits/{visit_id}/actions", response_model=list[CorrectiveActionWithDetails])
async def visit_actions(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        _with_details(
            select(CorrectiveAction)
            .where(CorrectiveAction.visit_id == visit_id)
            .order_by(CorrectiveAction.created_at)
        )
    )
    out = []
    for a in result.scalars().all():
        out.append(await _serialize(db, a))
    return out


@router.post("/visits/{visit_id}/actions", response_model=CorrectiveActionWithDetails,
             status_code=status.HTTP_201_CREATED)
async def create_action(
    visit_id: UUID,
    payload: CorrectiveActionCreate,
    current_user=Depends(require_permission(Permission.CREATE_ACTION)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Visit).where(Visit.id == visit_id))
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    ci_uuid: UUID | None = payload.checklist_item_id
    if ci_uuid:
        # Resolve to VisitChecklistItem.id if template ChecklistItem ID was provided
        v_check = await db.execute(
            select(VisitChecklistItem.id).where(
                VisitChecklistItem.id == ci_uuid,
                VisitChecklistItem.visit_id == visit.id,
            )
        )
        if not v_check.scalars().first():
            v_by_tpl = await db.execute(
                select(VisitChecklistItem.id).where(
                    VisitChecklistItem.checklist_item_id == ci_uuid,
                    VisitChecklistItem.visit_id == visit.id,
                )
            )
            ci_uuid = v_by_tpl.scalars().first()

    action = CorrectiveAction(
        visit_id=visit_id,
        checklist_item_id=ci_uuid,
        title=payload.title,
        description=payload.description,
        observation=payload.observation,
        action_required=payload.action_required,
        responsible_person_id=payload.responsible_person_id,
        target_date=payload.target_date,
        priority=payload.priority,
        status="OPEN",
        created_by=current_user.id,
    )
    db.add(action)
    await db.flush()

    if payload.responsible_person_id:
        audit_utils.create_notification(
            db, user_id=payload.responsible_person_id,
            title="Corrective Action Assigned",
            body=payload.title[:200],
            notif_type="ACTION_ASSIGNED", entity_type="corrective_action", entity_id=action.id,
        )
    await AuditLogger.log(db, user_id=current_user.id,
                          action="ACTION_CREATED", entity_type="corrective_action", entity_id=action.id,
                          details={"visit_id": str(visit_id)})
    result = await db.execute(
        _with_details(
            select(CorrectiveAction).where(CorrectiveAction.id == action.id)
        )
    )
    return await _serialize(db, result.scalar())


@router.patch("/actions/{action_id}", response_model=CorrectiveActionWithDetails)
async def update_action(
    action_id: UUID,
    payload: CorrectiveActionUpdate,
    current_user=Depends(require_permission(Permission.UPDATE_ACTION)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        _with_details(select(CorrectiveAction).where(CorrectiveAction.id == action_id))
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    is_responsible = action.responsible_person_id == current_user.id
    is_reviewer = any(
        r.name in ("SUPER_ADMIN", "ADMIN", "HOD", "AUDITOR")
        for r in current_user.roles
    )
    if not (is_responsible or is_reviewer):
        raise HTTPException(status_code=403, detail="Not authorized to update this action")

    data = payload.model_dump(exclude_unset=True)
    old_status = action.status
    for key, value in data.items():
        setattr(action, key, value)

    from datetime import datetime, timezone

    if "status" in data and data["status"] != old_status:
        if data["status"] == "COMPLETED" and not action.completed_at:
            action.completed_at = datetime.now(timezone.utc)
        if data["status"] == "IN_PROGRESS":
            action.completed_at = None
        if data["status"] == "CLOSED":
            action.closed_at = datetime.now(timezone.utc)
        if data["status"] == "VERIFICATION_PENDING":
            action.completed_at = action.completed_at or datetime.now(timezone.utc)

    # Auto-derive OVERDUE status if target date passed while open
    if action.status in ("OPEN", "IN_PROGRESS") and is_overdue(action.status, action.target_date):
        action.status = "OVERDUE"

    action.updated_by = current_user.id
    await AuditLogger.log(db, user_id=current_user.id,
                          action="ACTION_UPDATED", entity_type="corrective_action", entity_id=action.id,
                          details={"old_status": old_status, "new_status": action.status})
    return await _serialize(db, action)


@router.post("/actions/{action_id}/verify", response_model=CorrectiveActionWithDetails)
async def verify_action(
    action_id: UUID,
    current_user=Depends(require_permission(Permission.VERIFY_ACTION)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        _with_details(select(CorrectiveAction).where(CorrectiveAction.id == action_id))
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    if action.status not in ("VERIFICATION_PENDING", "COMPLETED"):
        raise HTTPException(status_code=409, detail="Action is not in a verifiable state")

    from datetime import datetime, timezone
    action.status = "CLOSED"
    action.closed_at = datetime.now(timezone.utc)
    action.updated_by = current_user.id

    await AuditLogger.log(db, user_id=current_user.id,
                          action="ACTION_VERIFIED", entity_type="corrective_action", entity_id=action.id)
    return await _serialize(db, action)


@router.post("/actions/{action_id}/evidence", response_model=dict)
async def request_verification(
    action_id: UUID,
    notes: str | None = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CorrectiveAction).where(CorrectiveAction.id == action_id)
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.responsible_person_id != current_user.id:
        roles = {r.name for r in current_user.roles}
        if not any(r in roles for r in ("SUPER_ADMIN", "ADMIN", "HOD")):
            raise HTTPException(status_code=403, detail="Not authorized")

    if action.status == "OVERDUE":
        action.status = "IN_PROGRESS"
    if action.status in ("OPEN", "IN_PROGRESS"):
        from datetime import datetime, timezone
        action.status = "COMPLETED"
        action.completed_at = datetime.now(timezone.utc)
    if notes:
        db.add(ActionEvidence(action_id=action.id, notes=notes, uploaded_by=current_user.id))

    await AuditLogger.log(db, user_id=current_user.id,
                          action="ACTION_COMPLETED", entity_type="corrective_action", entity_id=action.id)
    return {"message": "Action marked completed; verification pending"}