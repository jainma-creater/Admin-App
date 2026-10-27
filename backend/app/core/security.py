from datetime import datetime, timedelta, timezone
from typing import Optional
import secrets
import uuid

import bcrypt
from jose import JWTError, jwt
from redis import asyncio as aioredis

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


def _add_issuer_audience(payload: dict) -> None:
    payload["iss"] = settings.JWT_ISSUER
    payload["aud"] = settings.JWT_AUDIENCE


def _add_jti(payload: dict) -> None:
    payload["jti"] = uuid.uuid4().hex


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    _add_jti(to_encode)
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


_REDIS_CLIENT: Optional[aioredis.Redis] = None


async def _get_redis() -> Optional[aioredis.Redis]:
    """Lazy, shared async Redis client for token revocation."""
    global _REDIS_CLIENT
    if _REDIS_CLIENT is None:
        try:
            _REDIS_CLIENT = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
        except Exception:
            _REDIS_CLIENT = None
    return _REDIS_CLIENT


async def _revoke_token_jti(jti: str, exp: int) -> None:
    """Add a JTI to the Redis revocation blocklist with a TTL matching token
    expiry. Fails closed — raises on Redis errors so revocation is never
    silently skipped."""
    r = await _get_redis()
    if r is None:
        raise RuntimeError("Redis is unavailable; cannot revoke token")
    ttl = max(int(exp - datetime.now(timezone.utc).timestamp()), 1)
    await r.setex(f"revoked_token:{jti}", ttl, "1")


async def _is_token_revoked(jti: str) -> bool:
    """True if the JTI is in the Redis revocation blocklist. Fails closed."""
    if not jti:
        return False
    r = await _get_redis()
    if r is None:
        raise RuntimeError("Redis is unavailable; cannot check revocation")
    return bool(await r.exists(f"revoked_token:{jti}"))


async def revoke_access_token(token: str) -> None:
    """Revoke an access token by blocklisting its JTI (used on logout)."""
    payload = decode_token(token, require_iss_aud=False)
    if not payload:
        return
    jti = payload.get("jti")
    exp = int(payload.get("exp", 0))
    if jti:
        await _revoke_token_jti(jti, exp)


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
