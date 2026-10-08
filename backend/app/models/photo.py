from datetime import datetime
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.base import CreatedByMixin, TimestampMixin, UUIDMixin


class Photo(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "photos"
    __table_args__ = (
        # One evidence photo per (device, client-generated id) — offline retry
        # with the same Idempotency-Key must not create duplicate evidence.
        UniqueConstraint("device_id", "client_photo_id", name="uq_photos_device_client"),
    )

    visit_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), index=True
    )
    checklist_item_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visit_checklist_items.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    observation_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("observations.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    asset_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visit_assets.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    it_asset_row_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visit_it_assets.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    uploaded_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    device_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    client_photo_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="ACCEPTED", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    visit = relationship("Visit", back_populates="photos")
    uploader = relationship("User", foreign_keys=[uploaded_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    blob = relationship("PhotoBlob", back_populates="photo", uselist=False, passive_deletes=True)


class PhotoBlob(Base):
    """Image bytes stored directly in PostgreSQL (STORAGE_MODE=postgres).

    One row per photo; the compressed JPEG (+ optional thumbnail) live here so
    the database is the single source of truth for production photo evidence.
    Used only when STORAGE_MODE=postgres — MinIO/S3/local modes keep bytes in
    object storage and leave this table empty.
    """

    __tablename__ = "photo_blobs"

    photo_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("photos.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    thumbnail: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    photo = relationship("Photo", back_populates="blob", passive_deletes=True)


class Observation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "observations"

    visit_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), index=True
    )
    checklist_item_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visit_checklist_items.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="MEDIUM")

    visit = relationship("Visit", back_populates="observations")