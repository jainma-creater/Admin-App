from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class RoleBase(BaseModel):
    name: str
    description: Optional[str] = None


class RoleRead(RoleBase):
    id: UUID
    is_system: bool

    model_config = {'from_attributes': True}


class PermissionRead(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None

    model_config = {'from_attributes': True}


class UserBase(BaseModel):
    email: str
    phone: Optional[str] = None
    first_name: str
    last_name: str
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)
    role_ids: List[UUID] = []
    region_id: Optional[UUID] = None
    area_id: Optional[UUID] = None
    branch_id: Optional[UUID] = None


class UserUpdate(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: Optional[bool] = None
    role_ids: Optional[List[UUID]] = None
    region_id: Optional[UUID] = None
    area_id: Optional[UUID] = None
    branch_id: Optional[UUID] = None


class UserRead(UserBase):
    id: UUID
    region_id: Optional[UUID] = None
    area_id: Optional[UUID] = None
    branch_id: Optional[UUID] = None
    roles: List[RoleRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class UserMinimal(BaseModel):
    id: UUID
    email: str
    full_name: str
    roles: List[str] = []

    model_config = {'from_attributes': True}