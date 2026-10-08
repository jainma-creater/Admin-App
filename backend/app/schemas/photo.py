from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class PhotoRejectPayload(BaseModel):
    reason: str = Field(..., description="Rejection reason e.g. BLURRY, NOT_VISIBLE, WRONG_PHOTO, INVALID_EVIDENCE, OTHER")
    notes: Optional[str] = Field(None, description="Detailed explanation for the rejection")


class PhotoRead(BaseModel):
    id: UUID
    visit_id: UUID
    checklist_item_id: Optional[UUID] = None
    observation_id: Optional[UUID] = None
    uploaded_by: Optional[UUID] = None
    storage_path: str
    original_filename: Optional[str] = None
    thumbnail_path: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_enabled: bool
    captured_at: Optional[datetime] = None
    caption: Optional[str] = None
    status: Optional[str] = "ACCEPTED"
    rejection_reason: Optional[str] = None
    reviewed_by: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {'from_attributes': True}


class PhotoWithDetails(PhotoRead):
    uploader_name: Optional[str] = None
    reviewer_name: Optional[str] = None
    checklist_item_name: Optional[str] = None
    branch_name: Optional[str] = None
    visit_date: Optional[datetime] = None
    url: Optional[str] = None
    thumbnail_url: Optional[str] = None