from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class UUIDMixin:
    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CreatedByMixin:
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True
    )
    updated_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True
    )


class AuditLogEvent(str):
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
    VISIT_CREATED = "VISIT_CREATED"
    VISIT_ASSIGNED = "VISIT_ASSIGNED"
    VISIT_UPDATED = "VISIT_UPDATED"
    VISIT_SUBMITTED = "VISIT_SUBMITTED"
    CHECKLIST_MODIFIED = "CHECKLIST_MODIFIED"
    RESPONSE_MODIFIED = "RESPONSE_MODIFIED"
    PHOTO_UPLOADED = "PHOTO_UPLOADED"
    VISIT_REVIEWED = "VISIT_REVIEWED"
    VISIT_APPROVED = "VISIT_APPROVED"
    VISIT_REJECTED = "VISIT_REJECTED"
    VISIT_CLOSED = "VISIT_CLOSED"
    ACTION_CREATED = "ACTION_CREATED"
    ACTION_UPDATED = "ACTION_UPDATED"
    ACTION_COMPLETED = "ACTION_COMPLETED"
    ACTION_VERIFIED = "ACTION_VERIFIED"
    ACTION_CLOSED = "ACTION_CLOSED"