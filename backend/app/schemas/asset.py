from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class PhotoRef(BaseModel):
    id: UUID
    photo_url: Optional[str] = None
    photo_thumbnail_url: Optional[str] = None
    captured_at: Optional[datetime] = None


class VisitAssetBase(BaseModel):
    category: str
    name: Optional[str] = None
    code: Optional[str] = None
    status: str = "PENDING"


class VisitAssetCreate(VisitAssetBase):
    pass


class VisitAssetUpdate(BaseModel):
    category: Optional[str] = None
    name: Optional[str] = None
    code: Optional[str] = None
    ocr_confirmed: Optional[bool] = None
    status: Optional[str] = None
    sort_order: Optional[int] = None


class VisitAssetRead(VisitAssetBase):
    id: UUID
    visit_id: UUID
    ocr_raw: Optional[str] = None
    ocr_confirmed: bool = False
    code_photo_id: Optional[UUID] = None
    photo_url: Optional[str] = None
    photo_thumbnail_url: Optional[str] = None
    photos: List[PhotoRef] = []
    sort_order: int = 0
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    created_at: datetime

    model_config = {'from_attributes': True}


class VisitItAssetUpdate(BaseModel):
    status: Optional[str] = None
    code: Optional[str] = None
    ocr_confirmed: Optional[bool] = None
    remark: Optional[str] = None


class VisitItAssetRead(BaseModel):
    id: UUID
    visit_id: UUID
    employee_id: UUID
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    department: Optional[str] = None
    asset_type_id: UUID
    asset_type_name: Optional[str] = None
    status: str = "PENDING"
    code: Optional[str] = None
    ocr_raw: Optional[str] = None
    ocr_confirmed: bool = False
    remark: Optional[str] = None
    code_photo_id: Optional[UUID] = None
    photo_url: Optional[str] = None
    photo_thumbnail_url: Optional[str] = None
    photos: List[PhotoRef] = []
    created_at: datetime

    model_config = {'from_attributes': True}


class OcScanResult(BaseModel):
    code_photo_id: UUID
    ocr_text: str
    ocr_confidence: float
    # True when the plate read was queued and will be applied to the row
    # shortly. `ocr_text` is empty in that case by design: the photo is stored
    # and returned immediately, and the code is filled in (or left for manual
    # entry) once the worker finishes. False means the job was not accepted, so
    # the user must type the code.
    ocr_pending: bool = False


class VisitItAssetSummary(BaseModel):
    total: int = 0
    verified: int = 0
    pending: int = 0