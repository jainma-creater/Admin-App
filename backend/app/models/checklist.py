from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.base import CreatedByMixin, TimestampMixin, UUIDMixin


class ChecklistTemplate(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    """A versioned checklist template, e.g. 'Branch Visit Checklist v2.0'."""

    __tablename__ = "checklist_templates"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)

    visit_type_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visit_types.id", ondelete="SET NULL"), nullable=True
    )

    sections = relationship(
        "ChecklistSection",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="ChecklistSection.sort_order",
    )


class ChecklistSection(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "checklist_sections"

    template_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checklist_templates.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    template = relationship("ChecklistTemplate", back_populates="sections")
    items = relationship(
        "ChecklistItem",
        back_populates="section",
        cascade="all, delete-orphan",
        order_by="ChecklistItem.sort_order",
    )


class ChecklistItem(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "checklist_items"

    section_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checklist_sections.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_type: Mapped[str] = mapped_column(String(30), default="STATUS")
    options: Mapped[dict] = mapped_column(JSON, default=list)
    photo_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    photo_required_on: Mapped[list] = mapped_column(JSON, default=list)
    remark_required_on: Mapped[list] = mapped_column(JSON, default=list)
    action_required_on: Mapped[list] = mapped_column(JSON, default=list)
    responsible_required_on: Mapped[list] = mapped_column(JSON, default=list)
    target_date_required_on: Mapped[list] = mapped_column(JSON, default=list)
    weight: Mapped[int] = mapped_column(Integer, default=1)
    # Which role checklists include this item: e.g. ["ADMIN","HR","OPS"].
    # Empty list = visible to everyone (applies to all roles).
    role_tags: Mapped[list] = mapped_column(JSON, default=list)
    # Reference sample evidence for this item (filenames served from /static/samples),
    # shown to users so they know how to capture the required photo.
    sample_refs: Mapped[list] = mapped_column(JSON, default=list)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    section = relationship("ChecklistSection", back_populates="items")