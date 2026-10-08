from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class ClientIdempotency(Base):
    """Client-generated request keys (X-Idempotency-Key + X-Device-Id) mapped to
    the created entity, so an offline client that lost the response can replay a
    create (visit, upload) without duplicating data.

    Primary key = (key, user_id, method, path): the same client key sent by a
    different user, or against a different endpoint, never collides.
    """

    __tablename__ = "client_idempotency"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    method: Mapped[str] = mapped_column(String(16), primary_key=True)
    path: Mapped[str] = mapped_column(String(255), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )