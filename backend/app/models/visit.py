from datetime import date, datetime
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.base import CreatedByMixin, TimestampMixin, UUIDMixin


class VisitType(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "visit_types"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Visit(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "visits"

    branch_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    visit_type_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visit_types.id", ondelete="CASCADE"), index=True
    )
    template_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checklist_templates.id", ondelete="SET NULL"), index=True, nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(30),
        default="DRAFT",
        index=True,
    )
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM")
    scheduled_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    compliance_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    visitor_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    branch = relationship("Branch", lazy="selectin")
    visit_type = relationship("VisitType", lazy="selectin")
    template = relationship("ChecklistTemplate", lazy="selectin")
    assignments = relationship(
        "VisitAssignment", back_populates="visit", cascade="all, delete-orphan"
    )
    checklist_items = relationship(
        "VisitChecklistItem", back_populates="visit", cascade="all, delete-orphan"
    )
    photos = relationship("Photo", back_populates="visit", cascade="all, delete-orphan")
    observations = relationship("Observation", back_populates="visit", cascade="all, delete-orphan")
    actions = relationship("CorrectiveAction", back_populates="visit", cascade="all, delete-orphan")
    reviews = relationship("VisitReview", back_populates="visit", cascade="all, delete-orphan")


class VisitAssignment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "visit_assignments"

    visit_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    assignment_type: Mapped[str] = mapped_column(
        String(30), default="VISITOR"
    )

    visit = relationship("Visit", back_populates="assignments")
    user = relationship("User")


class VisitChecklistItem(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "visit_checklist_items"
    __table_args__ = (
        # One row per (visit, template item) — prevents hydration races/dupes
        # that previously caused photo-upload 500s and inflated progress counts.
        UniqueConstraint("visit_id", "checklist_item_id", name="uq_visit_checklist_item"),
    )

    visit_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), index=True
    )
    checklist_item_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checklist_items.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    response_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    observation: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_required: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_person_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)

    visit = relationship("Visit", back_populates="checklist_items")
    checklist_item = relationship("ChecklistItem")
    responsible_person = relationship("User", foreign_keys=[responsible_person_id])