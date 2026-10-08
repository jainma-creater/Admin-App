from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class RegionBase(BaseModel):
    name: str
    code: str


class RegionCreate(RegionBase):
    pass


class RegionRead(RegionBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class AreaBase(BaseModel):
    name: str
    code: str
    region_id: UUID


class AreaCreate(AreaBase):
    pass


class AreaRead(AreaBase):
    id: UUID
    region_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class BranchBase(BaseModel):
    name: str
    code: str
    region_id: UUID
    area_id: UUID
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gst_number: Optional[str] = None
    cin_number: Optional[str] = None
    branch_type: str = "STANDALONE"


class BranchCreate(BranchBase):
    manager_id: Optional[UUID] = None


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gst_number: Optional[str] = None
    cin_number: Optional[str] = None
    manager_id: Optional[UUID] = None
    is_active: Optional[bool] = None


class BranchRead(BranchBase):
    id: UUID
    manager_id: Optional[UUID] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    region_name: Optional[str] = None
    area_name: Optional[str] = None

    model_config = {'from_attributes': True}


class BranchWithStats(BranchRead):
    total_visits: int = 0
    average_compliance: float = 0.0
    open_actions: int = 0
    overdue_actions: int = 0