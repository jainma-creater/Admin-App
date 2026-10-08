from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: str
    type: str
    exp: int


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=6, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


# ---------- Public self-registration ----------

class RegisterOptionsRole(BaseModel):
    key: str
    label: str
    role: str
    description: str | None = None


class StateOption(BaseModel):
    """A state grouping for state-first register/branch flows that many
    field teams expect (pick your state, then see its branches)."""
    name: str
    branch_count: int = 0


class RegisterBranch(BaseModel):
    id: UUID
    name: str
    code: str
    state: str | None = None


class RegisterArea(BaseModel):
    id: UUID
    name: str
    code: str
    branches: list[RegisterBranch] = []


class RegisterRegion(BaseModel):
    id: UUID
    name: str
    code: str
    state: str | None = None
    areas: list[RegisterArea] = []


class RegisterOptions(BaseModel):
    roles: list[RegisterOptionsRole]
    regions: list[RegisterRegion]
    states: list[StateOption] = []


class RegisterRequest(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: str = Field(..., description="System role: HR | REGIONAL_ADMIN | BRANCH_MANAGER | AUDITOR")
    region_id: UUID | None = None
    area_id: UUID | None = None
    branch_id: UUID | None = None
    # State-first registration ("in register I get the state and branch"):
    # state name from the register-options `states` list; resolves to the
    # state-region for REGIONAL_ADMIN and pre-fills scope for other roles.
    state: str | None = None