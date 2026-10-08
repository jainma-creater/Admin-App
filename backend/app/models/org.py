from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.base import CreatedByMixin, TimestampMixin, UUIDMixin


class Region(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "regions"

    # Name is NOT globally unique: state-regions imported from the employee
    # master (sheet 2) can collide with pre-existing business region names.
    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    # States from the regional-admin sheet are stored as Regions whose name IS
    # the state name; `state` carries the display state for state-first
    # browsing (region/state names can drift, so we keep both explicit).
    state: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    areas = relationship("Area", back_populates="region", cascade="all, delete-orphan")


class Area(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "areas"

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    region_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("regions.id", ondelete="CASCADE"), index=True
    )

    region = relationship("Region", back_populates="areas")
    branches = relationship("Branch", back_populates="area", cascade="all, delete-orphan")


class Branch(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    __tablename__ = "branches"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    region_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("regions.id", ondelete="CASCADE"), index=True
    )
    area_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("areas.id", ondelete="CASCADE"), index=True
    )
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pincode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gst_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    cin_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    manager_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    branch_type: Mapped[str] = mapped_column(String(50), default="STANDALONE")

    area = relationship("Area", back_populates="branches")
    manager = relationship("User", foreign_keys=[manager_id])