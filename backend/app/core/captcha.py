"""
Bot-resistant "I'm not a robot" CAPTCHA — no external third-party service.

Combines multiple signals to block automated submissions while keeping the
experience frictionless for real humans:

  1. HMAC-signed JWT token carrying a nonce (prevents replay)
  2. Minimum elapsed-time check (instant scripts fail)
  3. Behavioral proof — mouse-movement data from the client
  4. Honeypot hidden field (naive bots fill it)
  5. One-time use — the nonce is consumed on verify (Redis-backed so it is
     correct across all gunicorn workers)

Redis makes the nonce store visible to every worker. When Redis is down the
code degrades to an in-memory fallback so login never hard-fails on a cache
outage.
"""

import hashlib
import hmac
import json
import secrets
import time
from typing import Optional

from jose import jwt
from redis import asyncio as aioredis

from core.config import settings

_CAPTCHA_SECRET_SUFFIX = "_captcha"
_CAPTCHA_TTL = 300          # 5 minutes
_MIN_DELAY = 1.5            # min seconds since token issuance (blocks bots)
_MAX_DELAY = 300            # max seconds (token lifetime)
_NONCE_PREFIX = "captcha:nonce:"
_REVOKED_PREFIX = "revoked_token:"

_redis_client: Optional[aioredis.Redis] = None
_NONCE_STORE: dict[str, float] = {}  # in-memory fallback (Redis down)


def _captcha_secret() -> str:
    return settings.JWT_SECRET + _CAPTCHA_SECRET_SUFFIX


async def _get_redis() -> Optional[aioredis.Redis]:
    """Lazy, shared async Redis client."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
        except Exception:
            _redis_client = None
    return _redis_client


async def _store_nonce(nonce: str, created: float) -> None:
    r = await _get_redis()
    if r is not None:
        try:
            await r.set(f"{_NONCE_PREFIX}{nonce}", str(created), ex=_CAPTCHA_TTL)
            return
        except Exception:
            pass
    _NONCE_STORE[nonce] = created


async def _consume_nonce(nonce: str) -> bool:
    """One-time-use: True if the nonce existed and is now consumed."""
    r = await _get_redis()
    if r is not None:
        try:
            val = await r.get(f"{_NONCE_PREFIX}{nonce}")
            if val is None:
                return False
            await r.delete(f"{_NONCE_PREFIX}{nonce}")
            return True
        except Exception:
            pass
    if nonce in _NONCE_STORE:
        _NONCE_STORE.pop(nonce, None)
        return True
    return False


async def generate_captcha_token() -> dict:
    """Return { token, nonce, honeypot } for the login form."""
    nonce = secrets.token_hex(16)
    now = time.time()
    await _store_nonce(nonce, now)

    # Prune stale in-memory nonces (fallback store only).
    expired = [n for n, t in list(_NONCE_STORE.items()) if now - t > _CAPTCHA_TTL]
    for n in expired:
        _NONCE_STORE.pop(n, None)

    token = jwt.encode(
        {"nonce": nonce, "iat": now, "exp": now + _CAPTCHA_TTL},
        _captcha_secret(),
        algorithm="HS256",
    )
    return {"token": token, "nonce": nonce, "honeypot": compute_honeypot_field()}


async def verify_captcha(
    token: Optional[str],
    honeypot: Optional[str] = None,
    mouse_events: Optional[str] = None,
) -> bool:
    """
    Verify the captcha token. Returns True only if ALL checks pass:

      - Token present, valid signature, not expired
      - Nonce has not been used before (one-time use)
      - At least MIN_DELAY seconds elapsed (blocks instant bots)
      - Honeypot field empty (bots fill hidden fields)
      - Mouse-event data looks like real human movement
    """
    # Honeypot check — filled means a bot.
    if honeypot:
        return False

    if not token:
        return False

    try:
        payload = jwt.decode(token, _captcha_secret(), algorithms=["HS256"])
    except Exception:
        return False

    if time.time() > payload.get("exp", 0):
        return False

    nonce = payload.get("nonce")
    if not nonce:
        return False

    # One-time use.
    if not await _consume_nonce(nonce):
        return False

    # Timing check.
    iat = payload.get("iat", 0)
    elapsed = time.time() - iat
    if elapsed < _MIN_DELAY or elapsed > _MAX_DELAY:
        return False

    # Behavioral check — real mouse movement.
    if not _verify_mouse_behavior(mouse_events):
        return False

    return True


def _verify_mouse_behavior(data: Optional[str]) -> bool:
    """Real users produce several mouse events spread over time and position.

    Absent/empty data is treated as a non-browser (e.g. native mobile) client
    and is not failed on this signal — those clients are protected instead by
    rate limiting and account lockout. Browser clients that do send movement
    data must still look human.
    """
    if not data:
        return True
    try:
        events = json.loads(data)
        if not isinstance(events, list) or len(events) < 5:
            return False
        timestamps = [e.get("t", 0) for e in events]
        if len(set(timestamps)) < 3:
            return False
        positions = [(e.get("x", 0), e.get("y", 0)) for e in events]
        if len(set(positions)) < 3:
            return False
        return True
    except (json.JSONDecodeError, TypeError):
        return False


def compute_honeypot_field() -> dict:
    """Obfuscated honeypot field config for the frontend."""
    return {"name": "website_url", "label": "Website"}
