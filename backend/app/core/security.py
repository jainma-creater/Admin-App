from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid

import bcrypt
from jose import JWTError, jwt

from .config import settings


def _encode(password: str) -> bytes:
    return password.encode("utf-8")[:72]


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(_encode(plain_password), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(_encode(password), bcrypt.gensalt()).decode("utf-8")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    _add_issuer_audience(to_encode)
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    # Add entropy so concurrent logins/refreshes for the same user within one
    # second never collide (they are stored in a unique-indexed column).
    to_encode.update({"exp": expire, "type": "refresh", "jti": uuid.uuid4().hex})
    _add_issuer_audience(to_encode)
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _add_issuer_audience(payload: dict) -> None:
    payload["iss"] = settings.JWT_ISSUER
    payload["aud"] = settings.JWT_AUDIENCE


def decode_token(token: str, *, require_iss_aud: bool = True) -> Optional[dict]:
    """Strict JWT validation: signature, expiry, token type, and (unless
    explicitly opted out) issuer + audience so foreign tokens are rejected
    even if they are signed with a leaked secret of a related service."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_aud": require_iss_aud, "verify_iss": require_iss_aud},
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
        )
        return payload
    except JWTError:
        return None
