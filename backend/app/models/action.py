from datetime import date, datetime
from sqlalchemy import (
    DateTime,
    Date,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.base import CreatedByMixin, TimestampMixin, UUIDMixin


class CorrectiveAction(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "corrective_actions"

    visit_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), index=True
    )
    checklist_item_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visit_checklist_items.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    observation: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_required: Mapped[str] = mapped_column(Text, nullable=False)
    responsible_person_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM")
    status: Mapped[str] = mapped_column(String(30), default="OPEN", index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    visit = relationship("Visit", back_populates="actions")
    responsible_person = relationship("User", foreign_keys=[responsible_person_id])
    evidences = relationship(
        "ActionEvidence", back_populates="action", cascade="all, delete-orphan"
    )


class ActionEvidence(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "action_evidence"

    action_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("corrective_actions.id", ondelete="CASCADE"), index=True
    )
    photo_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("photos.id", ondelete="SET NULL"), nullable=True
    )
    storage_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    action = relationship("CorrectiveAction", back_populates="evidences")