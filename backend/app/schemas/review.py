from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID


class VisitReviewCreate(BaseModel):
    decision: str
    comments: Optional[str] = None


class VisitReviewRead(BaseModel):
    id: UUID
    visit_id: UUID
    reviewer_id: UUID
    decision: str
    comments: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {'from_attributes': True}


class VisitReviewWithDetails(VisitReviewRead):
    reviewer_name: Optional[str] = None
    reviewer_email: Optional[str] = None