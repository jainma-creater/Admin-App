from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class EmployeeCreate(BaseModel):
    emp_code: str
    name: str
    department: Optional[str] = None
    branch_id: UUID


class EmployeeUpdate(BaseModel):
    emp_code: Optional[str] = None
    name: Optional[str] = None
    department: Optional[str] = None
    branch_id: Optional[UUID] = None
    hr_manager_id: Optional[UUID] = None
    is_active: Optional[bool] = None


class EmployeeRead(BaseModel):
    id: UUID
    emp_code: str
    name: str
    department: Optional[str] = None
    branch_id: UUID
    branch_name: Optional[str] = None
    state: Optional[str] = None
    hr_manager_id: Optional[UUID] = None
    hr_manager_name: Optional[str] = None
    is_active: bool = True
    verified_count: int = 0
    total_assets: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class EmployeeImportResult(BaseModel):
    total: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    created_regions: int = 0
    created_areas: int = 0
    created_branches: int = 0
    created_users: int = 0
    created_hr_mappings: int = 0
    errors: List[str] = []


class EmployeeAssetPhotoRef(BaseModel):
    id: UUID
    photo_url: str
    photo_thumbnail_url: Optional[str] = None
    captured_at: Optional[datetime] = None


class EmployeeAssetItem(BaseModel):
    id: Optional[UUID] = None
    asset_type_id: UUID
    asset_type_name: str
    code: Optional[str] = None
    status: str = "PENDING"
    ocr_raw: Optional[str] = None
    ocr_confirmed: bool = False
    remark: Optional[str] = None
    visit_id: Optional[UUID] = None
    visit_branch_name: Optional[str] = None
    verified_by_name: Optional[str] = None
    verified_at: Optional[datetime] = None
    code_photo_id: Optional[UUID] = None
    photo_url: Optional[str] = None
    photo_thumbnail_url: Optional[str] = None
    photos: List[EmployeeAssetPhotoRef] = []


class EmployeeDetail(BaseModel):
    id: UUID
    emp_code: str
    name: str
    department: Optional[str] = None
    branch_id: UUID
    branch_name: Optional[str] = None
    state: Optional[str] = None
    is_active: bool = True
    verified_count: int = 0
    total_assets: int = 0
    created_at: datetime
    updated_at: datetime
    assets: List[EmployeeAssetItem] = []

    model_config = {'from_attributes': True}


class EmployeeAssetUpdatePayload(BaseModel):
    code: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None
    ocr_confirmed: Optional[bool] = None


class EmployeeAssetCreatePayload(BaseModel):
    asset_type_id: UUID
    code: Optional[str] = None
    status: Optional[str] = "VERIFIED"
    remark: Optional[str] = None


class ItAssetTypeCreate(BaseModel):
    name: str


class ItAssetTypeUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class ItAssetTypeRead(BaseModel):
    id: UUID
    name: str
    is_active: bool
    sort_order: int

    model_config = {'from_attributes': True}


class ItAssetAllocationCreate(BaseModel):
    employee_id: UUID
    asset_type_id: UUID
    device_code: str
    allocation_year: int
    remark: Optional[str] = None


class ItAssetAllocationUpdate(BaseModel):
    device_code: Optional[str] = None
    allocation_year: Optional[int] = None
    status: Optional[str] = None
    remark: Optional[str] = None


class ItAssetAllocationRead(BaseModel):
    id: UUID
    employee_id: UUID
    employee_name: Optional[str] = None
    employee_code: Optional[str] = None
    asset_type_id: UUID
    asset_type_name: str
    device_code: str
    allocation_year: int
    status: str
    remark: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class ItAssetAllocationList(BaseModel):
    total: int = 0
    allocations: List[ItAssetAllocationRead] = []