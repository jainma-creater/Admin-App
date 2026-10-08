"""Bounded execution for CPU-heavy image work (decode, compress, thumbnails).

`anyio.to_thread.run_sync` draws from anyio's shared 40-token thread limiter,
which is shared with every other blocking call in the process. Under a burst
of concurrent evidence-photo uploads that means dozens of simultaneous
high-resolution JPEG encodes competing for the same CPU, so request latency
climbs and workers start timing out even though the box is not yet overloaded.

Running image jobs on a dedicated, explicitly sized pool:
- keeps CPU-heavy encodes away from short blocking calls (S3/MinIO puts, blob
  reads) that would otherwise queue behind them,
- lets the ceiling be tuned per host (small instances need fewer workers than
  large ones),
- makes the concurrency visible for load-test diagnostics.

Exceeding the ceiling makes callers *wait* — unlike OCR, compression is cheap
enough and required for the upload to succeed at all, so it must not be skipped.
"""
from __future__ import annotations

import asyncio
import functools
from concurrent.futures import ThreadPoolExecutor

from core.config import settings

_CONCURRENCY = max(1, int(getattr(settings, "IMAGE_MAX_CONCURRENCY", 4)))

_executor = ThreadPoolExecutor(
    max_workers=_CONCURRENCY,
    thread_name_prefix="image",
)

# Guards the pool so we never submit more queued work than the host can chew
# through; beyond this, callers block on the semaphore instead of piling up
# unbounded futures (which would just grow RSS).
_gate = asyncio.Semaphore(_CONCURRENCY)


def image_runtime_info() -> dict:
    """Introspection for /health and load-test diagnostics."""
    return {
        "max_concurrency": _CONCURRENCY,
        "at_capacity": _gate.locked(),
    }


async def run_image_job(fn, *args, **kwargs):
    """Run a blocking image function on the dedicated pool."""
    await _gate.acquire()
    try:
        loop = asyncio.get_running_loop()
        call = functools.partial(fn, *args, **kwargs)
        return await loop.run_in_executor(_executor, call)
    finally:
        _gate.release()


async def shutdown_image_runtime() -> None:
    """Drain the image executor on application shutdown."""
    _executor.shutdown(wait=False, cancel_futures=True)