from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from uuid import UUID


class CorrectiveActionCreate(BaseModel):
    checklist_item_id: Optional[UUID] = None
    title: str
    description: Optional[str] = None
    observation: Optional[str] = None
    action_required: str
    responsible_person_id: Optional[UUID] = None
    target_date: Optional[date] = None
    priority: str = "MEDIUM"


class CorrectiveActionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    observation: Optional[str] = None
    action_required: Optional[str] = None
    responsible_person_id: Optional[UUID] = None
    target_date: Optional[date] = None
    priority: Optional[str] = None
    status: Optional[str] = None


class CorrectiveActionRead(BaseModel):
    id: UUID
    visit_id: UUID
    checklist_item_id: Optional[UUID] = None
    title: str
    description: Optional[str] = None
    observation: Optional[str] = None
    action_required: str
    responsible_person_id: Optional[UUID] = None
    target_date: Optional[date] = None
    priority: str
    status: str
    completed_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class CorrectiveActionWithDetails(CorrectiveActionRead):
    responsible_person_name: Optional[str] = None
    responsible_person_email: Optional[str] = None
    checklist_item_name: Optional[str] = None
    evidence_count: int = 0
    branch_name: Optional[str] = None
    is_overdue: bool = False


class ActionEvidenceCreate(BaseModel):
    notes: Optional[str] = None


class ActionEvidenceRead(BaseModel):
    id: UUID
    action_id: UUID
    photo_id: Optional[UUID] = None
    storage_path: Optional[str] = None
    notes: Optional[str] = None
    uploaded_by: Optional[UUID] = None
    created_at: datetime

    model_config = {'from_attributes': True}