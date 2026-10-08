from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from uuid import UUID


class VisitTypeRead(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    is_active: bool
    allowed: bool = True

    model_config = {'from_attributes': True}


class VisitTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None


class VisitCreate(BaseModel):
    branch_id: UUID
    visit_type_id: UUID
    scheduled_date: Optional[date] = None
    priority: str = "MEDIUM"
    instructions: Optional[str] = None
    visitor_ids: List[UUID] = []
    reviewer_ids: List[UUID] = []


class VisitUpdate(BaseModel):
    scheduled_date: Optional[date] = None
    priority: Optional[str] = None
    instructions: Optional[str] = None
    visitor_notes: Optional[str] = None


class VisitRead(BaseModel):
    id: UUID
    branch_id: UUID
    visit_type_id: UUID
    template_id: Optional[UUID] = None
    status: str
    priority: str
    scheduled_date: Optional[date] = None
    started_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    total_score: Optional[float] = None
    compliance_percentage: Optional[float] = None
    instructions: Optional[str] = None
    visitor_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class VisitWithDetails(VisitRead):
    branch_name: Optional[str] = None
    branch_code: Optional[str] = None
    visit_type_name: Optional[str] = None
    visitors: list = []
    reviewers: list = []
    total_items: int = 0
    completed_items: int = 0
    failed_items: int = 0
    action_count: int = 0
    photo_count: int = 0


class VisitAssignmentCreate(BaseModel):
    user_id: UUID
    assignment_type: str = "VISITOR"


class VisitAssignmentRead(BaseModel):
    id: UUID
    visit_id: UUID
    user_id: UUID
    assignment_type: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None

    model_config = {'from_attributes': True}


class VisitChecklistItemUpdate(BaseModel):
    status: Optional[str] = None
    response_value: Optional[dict] = None
    remark: Optional[str] = None
    observation: Optional[str] = None
    action_required: Optional[str] = None
    responsible_person_id: Optional[UUID] = None
    target_date: Optional[date] = None


class VisitChecklistItemRead(BaseModel):
    id: UUID
    visit_id: UUID
    checklist_item_id: UUID
    # Template section this item belongs to (for grouped checklist UI)
    section_name: Optional[str] = None
    status: Optional[str] = None
    response_value: Optional[dict] = None
    remark: Optional[str] = None
    observation: Optional[str] = None
    action_required: Optional[str] = None
    responsible_person_id: Optional[UUID] = None
    target_date: Optional[date] = None
    is_completed: bool
    item_name: Optional[str] = None
    item_description: Optional[str] = None
    response_type: Optional[str] = None
    options: list = []
    photo_allowed: bool = True
    photo_required_on: list = []
    remark_required_on: list = []
    action_required_on: list = []
    responsible_required_on: list = []
    target_date_required_on: list = []
    # Role tags from the template item — the mobile app filters the checklist
    # by the signed-in user's roles using this (empty/null = all roles).
    role_tags: Optional[list] = []
    # Reference sample evidence filenames (served from /static/samples/).
    sample_refs: Optional[list] = []

    model_config = {'from_attributes': True}


class ChecklistResponse(BaseModel):
    visit_id: UUID
    template: dict
    items: List[VisitChecklistItemRead] = []
    progress: float = 0.0
    completed_count: int = 0
    total_count: int = 0