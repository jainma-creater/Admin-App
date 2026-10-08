"""Redis-backed fixed-window rate limiter with a per-process memory fallback.

Helps against brute-force login, account-registration spam and API abuse.
When Redis is unreachable we degrade to a per-process counter so the API never
fails closed on a cache outage.

Keyed by client IP (respecting X-Forwarded-For set by nginx). Limits live in
core/config.py so they can be tuned per environment without code changes.
"""
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from core.config import settings
from utils.audit import client_ip

_REDIS_CLIENT = None
_MEMORY = {}

# Liveness/metrics must never be rate limited. They are polled by Docker,
# uptime monitors and load-test harnesses, so counting them would let
# infrastructure traffic consume a real user's budget (and previously made
# the container report unhealthy purely because its own healthcheck hit a
# limited endpoint).
_EXEMPT_SUFFIXES = (
    "/health",
    "/metrics",
    "/api/v1/health",
    "/api/v1/metrics",
    "/",
    "/api/v1",
)


def _is_exempt(path: str) -> bool:
    normalized = path.rstrip("/") or "/"
    for suffix in _EXEMPT_SUFFIXES:
        if normalized == suffix.rstrip("/") or normalized.endswith(suffix):
            return True
    return False


class _MemoryStore:
    def __init__(self):
        self._data = {}

    def incr(self, key: str, window_s: int) -> int:
        now = int(time.time())
        win_start = now - (now % window_s)
        rec = self._data.get(key)
        if rec is None or rec[0] != win_start:
            self._data[key] = (win_start, 1)
            return 1
        count = rec[1] + 1
        self._data[key] = (win_start, count)
        return count


_MEMORY_STORE = _MemoryStore()


async def _get_redis():
    global _REDIS_CLIENT
    if _REDIS_CLIENT is None:
        from redis import asyncio as aioredis

        _REDIS_CLIENT = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    await _REDIS_CLIENT.ping()
    return _REDIS_CLIENT


async def _incr_redis(key: str, window_s: int):
    rc = await _get_redis()
    rkey = f"rl:{key}:{int(time.time()) // window_s}"
    pipe = rc.pipeline(transaction=False)
    pipe.incr(rkey)
    pipe.expire(rkey, window_s + 5)
    result, _ = await pipe.execute()
    return int(result)


def _limits_for(path: str):
    if path.endswith("/auth/login"):
        return "login", settings.RATE_LIMIT_LOGIN_PER_MINUTE, 60
    if path.endswith("/auth/refresh"):
        return "refresh", settings.RATE_LIMIT_REFRESH_PER_MINUTE, 60
    # Only the account-creating POST is abuse-prone. /auth/register-options is
    # read-only metadata (region/role lists for the signup form) and is polled
    # by clients and the container healthcheck, so putting it in the 60/hour
    # register bucket locked everyone out for an hour at a time.
    if path.endswith("/auth/register"):
        return "register", settings.RATE_LIMIT_REGISTER_PER_HOUR, 3600
    return "api", settings.RATE_LIMIT_API_PER_MINUTE, 60


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not settings.RATE_LIMIT_ENABLED:
            return await call_next(request)

        if _is_exempt(request.url.path):
            return await call_next(request)

        kind, limit, window_s = _limits_for(request.url.path)
        key = f"{kind}:{client_ip(request)}"

        try:
            count = await _incr_redis(key, window_s)
        except Exception:
            count = _MEMORY_STORE.incr(key, window_s)

        if count > limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please try again shortly."},
                headers={
                    "Retry-After": str(window_s),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers.setdefault("X-RateLimit-Limit", str(limit))
        response.headers.setdefault("X-RateLimit-Remaining", str(max(limit - count, 0)))
        return response