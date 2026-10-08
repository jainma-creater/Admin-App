from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission
from models.visit import Visit, VisitAssignment
from models.misc import VisitReview
from schemas.review import VisitReviewWithDetails

router = APIRouter(tags=["reviews"])


@router.get("/visits/{visit_id}/reviews", response_model=list[VisitReviewWithDetails])
async def visit_reviews(
    visit_id: UUID,
    current_user=Depends(require_permission(Permission.READ_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VisitReview)
        .where(VisitReview.visit_id == visit_id)
        .order_by(VisitReview.created_at.desc())
    )
    reviews = result.scalars().all()
    out = []
    for r in reviews:
        item = VisitReviewWithDetails.model_validate(r, from_attributes=True)
        if r.reviewer:
            item.reviewer_name = r.reviewer.full_name
            item.reviewer_email = r.reviewer.email
        out.append(item)
    return out


@router.get("/reviews/pending", response_model=list[dict])
async def pending_reviews(
    current_user=Depends(require_permission(Permission.REVIEW_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    """Visits in SUBMITTED/UNDER_REVIEW state that need a reviewer decision."""
    result = await db.execute(
        select(Visit)
        .options(
            selectinload(Visit.assignments).selectinload(VisitAssignment.user),
            selectinload(Visit.branch),
        )
        .where(Visit.status.in_(["SUBMITTED", "UNDER_REVIEW"]))
        .order_by(Visit.submitted_at)
    )
    out = []
    for v in result.scalars().all():
        reviewers = [a.user_id for a in v.assignments if a.assignment_type == "REVIEWER"]
        is_assigned = current_user.id in reviewers or any(
            r.name in ("SUPER_ADMIN", "ADMIN", "HOD", "AUDITOR") for r in current_user.roles
        )
        if is_assigned:
            out.append({
                "visit_id": str(v.id),
                "branch": v.branch.name if v.branch else None,
                "status": v.status,
                "submitted_at": v.submitted_at,
                "compliance_percentage": v.compliance_percentage,
            })
    return out