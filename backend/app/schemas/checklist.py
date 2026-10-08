from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class ChecklistItemCreate(BaseModel):
    name: str
    description: Optional[str] = None
    response_type: str = "STATUS"
    options: list = ["OK", "NOT_OK", "NA"]
    photo_allowed: bool = True
    photo_required_on: list = ["NOT_OK"]
    remark_required_on: list = []
    action_required_on: list = ["NOT_OK"]
    responsible_required_on: list = ["NOT_OK"]
    target_date_required_on: list = ["NOT_OK"]
    weight: int = 1
    # Role tags: which role checklists include this item (ADMIN/HR/OPS/OTHERS).
    # Empty = visible to all roles.
    role_tags: list = []
    # Reference sample evidence filenames (served from /static/samples/).
    sample_refs: list = []
    is_required: bool = True
    sort_order: int = 0


class ChecklistItemRead(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    response_type: str
    options: list
    photo_allowed: bool
    photo_required_on: list
    remark_required_on: list
    action_required_on: list
    responsible_required_on: list
    target_date_required_on: list
    weight: int
    role_tags: list = []
    sample_refs: list = []
    is_required: bool
    is_active: bool
    sort_order: int

    model_config = {'from_attributes': True}


class ChecklistSectionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sort_order: int = 0
    items: List[ChecklistItemCreate] = []


class ChecklistSectionRead(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    sort_order: int
    items: List[ChecklistItemRead] = []

    model_config = {'from_attributes': True}


class ChecklistTemplateCreate(BaseModel):
    name: str
    version: str
    description: Optional[str] = None
    visit_type_id: Optional[UUID] = None
    sections: List[ChecklistSectionCreate] = []


class ChecklistTemplateRead(BaseModel):
    id: UUID
    name: str
    version: str
    description: Optional[str] = None
    is_active: bool
    is_published: bool
    visit_type_id: Optional[UUID] = None
    sections: List[ChecklistSectionRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class ChecklistTemplateMinimal(BaseModel):
    id: UUID
    name: str
    version: str
    is_active: bool

    model_config = {'from_attributes': True}