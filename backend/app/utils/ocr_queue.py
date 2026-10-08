"""Redis-backed OCR work queue: keep photo uploads off the OCR critical path.

Why
---
`code-photo` used to `await` OCR inline. A single plate read takes ~20-25s on
this host (PaddleOCR inference plus the escalation sweep, and a cold child pays
~20s of model load), so an inspector tapping "scan" waited that long before the
upload response came back - and under any concurrency the request queue filled
with multi-second calls.

The photo itself is the compliance artifact; the read code is convenience
enrichment. So the upload now persists the photo and returns immediately, and
OCR runs afterwards on a worker service, writing the result back to the row.

Design notes
------------
- Transport is the Redis that is already deployed and already used for rate
  limiting, so this adds no new broker or dependency.
- Payload is the *original* high-resolution bytes, base64-encoded. OCR needs the
  full-res frame (the compressed copy loses small plate text) and the original
  is otherwise discarded after the upload response.
- Because those bytes live in Redis, both the per-job size and the queue depth
  are capped, and an over-budget job is simply not queued - the row keeps a null
  code for manual entry, which is the degradation this system already documents.
  Capping matters: `MAX_PHOTO_SIZE_MB` is 10MB and unbounded blob storage in
  Redis is how you OOM a shared box.
- The queue is best-effort. If Redis is unreachable the upload still succeeds.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid

from core.config import settings

log = logging.getLogger(__name__)

_QUEUE_KEY = "bv:ocr:jobs"
_DEPTH_KEY = "bv:ocr:depth"

_redis = None


def _max_bytes() -> int:
    return max(0, int(getattr(settings, "OCR_QUEUE_MAX_BYTES", 2 * 1024 * 1024)))


def _max_depth() -> int:
    return max(1, int(getattr(settings, "OCR_QUEUE_MAX_DEPTH", 200)))


async def _get_redis():
    global _redis
    if _redis is None:
        from redis import asyncio as aioredis

        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
    return _redis


async def enqueue_ocr(
    *,
    photo_id: str,
    target_kind: str,
    target_id: str,
    visit_id: str,
    user_id: str | None,
    data: bytes,
) -> bool:
    """Queue an OCR job. Returns True if accepted, False if skipped.

    A False return is normal and harmless: the photo is already stored and the
    code stays null for manual entry.
    """
    if not data or len(data) > _max_bytes():
        log.info(
            "ocr not queued: photo is %d bytes (budget %d) — code left for manual entry",
            len(data), _max_bytes(),
        )
        return False
    try:
        rc = await _get_redis()
        depth = int(await rc.llen(_QUEUE_KEY))
        if depth >= _max_depth():
            log.warning(
                "ocr not queued: queue depth %d at budget %d — code left for manual entry",
                depth, _max_depth(),
            )
            return False
        job = {
            "id": uuid.uuid4().hex,
            "photo_id": photo_id,
            "target_kind": target_kind,
            "target_id": target_id,
            "visit_id": visit_id,
            "user_id": user_id,
            "bytes_b64": base64.b64encode(data).decode("ascii"),
        }
        await rc.rpush(_QUEUE_KEY, json.dumps(job).encode("utf-8"))
        return True
    except Exception as exc:
        # Never fail an upload because the enrichment queue is down.
        log.warning("ocr enqueue failed (%s: %s) — code left for manual entry",
                    type(exc).__name__, exc)
        return False


async def dequeue_ocr(timeout: int = 5) -> dict | None:
    """Blocking pop, or None on idle/timeout. Used by the worker service."""
    try:
        rc = await _get_redis()
        item = await rc.blpop(_QUEUE_KEY, timeout=timeout)
        if not item:
            return None
        return json.loads(item[1].decode("utf-8"))
    except Exception as exc:
        log.warning("ocr dequeue failed (%s: %s)", type(exc).__name__, exc)
        await asyncio.sleep(2)
        return None


async def queue_depth() -> int:
    try:
        rc = await _get_redis()
        return int(await rc.llen(_QUEUE_KEY))
    except Exception:
        return -1


async def close_queue() -> None:
    global _redis
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None