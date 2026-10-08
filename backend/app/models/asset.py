from datetime import datetime
from sqlalchemy import (
    Boolean,
    DateTime,
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


class VisitAsset(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    """A fixed asset row captured during a Regional Admin Visit.

    Assets are free-form: the inspector adds a category ("Fan", "Chair",
    "Table"...), optionally a name, then photographs the printed code plate.
    The photo upload runs server-side OCR and stores ocr_raw; the inspector
    confirms/edits the code and ticks ocr_confirmed."""

    __tablename__ = "visit_assets"

    visit_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ocr_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    code_photo_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("photos.id", ondelete="SET NULL"), nullable=True
    )

    creator = relationship("User", foreign_keys="VisitAsset.created_by")
    visit = relationship("Visit", lazy="selectin")
    photos = relationship(
        "Photo",
        primaryjoin="Photo.asset_id == VisitAsset.id",
        order_by="Photo.created_at",
    )


class Employee(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    """Employee master record (imported from Excel/CSV by Regional Admin /
    Super Admin). Employees belong to a branch, may have an HR manager,
    and own IT assets that are verified during Regional Admin Visits."""

    __tablename__ = "employees"

    emp_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str | None] = mapped_column(String(150), nullable=True)
    branch_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    hr_manager_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    branch = relationship("Branch", lazy="selectin")
    hr_manager = relationship("User", foreign_keys=[hr_manager_id])


class ItAssetType(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    """Expected IT asset kinds (Laptop, Mobile, ...). Active types
    apply to every employee — new types appear for all employees."""

    __tablename__ = "it_asset_types"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ItAssetAllocation(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    """Super-admin device allocation: assigns a specific device (laptop,
    mobile, etc.) with its serial/code to an employee for a given year.

    One row per (employee, asset_type, allocation_year, device_code). This
    lets a super admin give an employee 2 laptops + 3 mobiles and track which
    physical device went to which employee across annual reincarnation cycles.
    Regional admins verify these codes during the yearly visit.
    """

    __tablename__ = "it_asset_allocations"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "asset_type_id", "allocation_year", "device_code",
            name="uq_it_asset_alloc_device",
        ),
    )

    employee_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), index=True
    )
    asset_type_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("it_asset_types.id", ondelete="CASCADE"), index=True
    )
    device_code: Mapped[str] = mapped_column(String(255), nullable=False)
    allocation_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="ASSIGNED")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)

    employee = relationship("Employee", lazy="selectin")
    asset_type = relationship("ItAssetType", lazy="selectin")


class VisitItAsset(UUIDMixin, TimestampMixin, CreatedByMixin, Base):
    """One verification snapshot per (visit, employee, it_asset_type).

    Rows are pre-created for every active employee + active asset type when
    the IT screen is opened, so the inspector simply taps an asset, scans its
    code plate and confirms the OCR result.

    During verification the regional admin's captured code is cross-checked
    against ItAssetAllocation (same employee + asset_type + current year) so
    the system can confirm the device really belongs to this employee.
    """

    __tablename__ = "visit_it_assets"
    __table_args__ = (
        UniqueConstraint(
            "visit_id", "employee_id", "asset_type_id",
            name="uq_visit_it_asset_employee_type",
        ),
    )

    visit_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), index=True
    )
    employee_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), index=True
    )
    asset_type_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("it_asset_types.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ocr_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    allocation_matched: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    code_photo_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("photos.id", ondelete="SET NULL"), nullable=True
    )

    employee = relationship("Employee", lazy="selectin")
    asset_type = relationship("ItAssetType", lazy="selectin")
    visit = relationship("Visit", lazy="selectin")
    photos = relationship(
        "Photo",
        primaryjoin="Photo.it_asset_row_id == VisitItAsset.id",
        order_by="Photo.created_at",
    )