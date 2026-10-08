import datetime as _dt
from datetime import datetime, timezone

from fastapi import Request


def utcnow():
    return datetime.now(timezone.utc)


def client_ip(request: Request) -> str:
    """Resolve the real client IP.

    The API sits behind nginx which always sets X-Forwarded-For; the first hop
    in that header is the client address as seen by the proxy. When the header
    is absent (direct/socketio/test calls) fall back to the socket peer.
    """
    if request is None:
        return ""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        first = fwd.split(",")[0].strip()
        if first:
            return first
    if request.client:
        return request.client.host
    return ""


def user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:500]


class AuditLogger:
    """Lightweight wrapper to write audit log entries from services."""

    @staticmethod
    async def log(db, *, user_id, action, entity_type=None, entity_id=None,
                  details=None, request: Request | None = None):
        try:
            from models.misc import AuditLog
            import uuid as _uuid

            u = None
            e = None
            if user_id:
                u = _uuid.UUID(str(user_id))
            if entity_id:
                e = str(entity_id)

            ip = client_ip(request) if request else None
            ua = user_agent(request) if request else None

            log = AuditLog(
                user_id=u,
                action=action,
                entity_type=entity_type,
                entity_id=e,
                details=details,
                ip_address=ip,
                user_agent=ua,
            )
            db.add(log)
        except Exception:
            pass


def create_notification(db, *, user_id, title, body=None, notif_type="GENERAL",
                        entity_type=None, entity_id=None):
    from models.misc import Notification

    n = Notification(
        user_id=user_id,
        title=title,
        body=body,
        type=notif_type,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id else None,
    )
    db.add(n)


def is_overdue(status: str, target_date) -> bool:
    if status in ("OPEN", "IN_PROGRESS", "VERIFICATION_PENDING"):
        if target_date is not None:
            return target_date < _dt.date.today()
    return False