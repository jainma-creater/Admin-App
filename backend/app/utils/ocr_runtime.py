"""Bounded, killable, cluster-wide-gated OCR for the request path.

Why this module exists
----------------------
`ocr_code_plate` is expensive: a PaddleOCR inference plus a multi-variant
Tesseract sweep. Two earlier attempts to tame it were not enough:

1. Originally every upload did `create_task(anyio.to_thread.run_sync(...))`,
   which borrowed a token from anyio's shared 40-per-loop limiter - up to 40
   concurrent inferences per worker process.
2. Replacing that with a `ThreadPoolExecutor` + `Semaphore` bounded how many
   OCR calls *started*, but not how much CPU they *used*, and - the fatal part -
   a timeout could not reclaim anything. `Future.cancel()` cannot stop a thread
   that has already started, so every timeout left a runaway inference burning
   cores forever while the caller had already been told "skipped". Measured on
   production: CPU pinned at ~380%, host load average climbing past 44, and
   orphaned `tesseract` processes still running minutes after load stopped.

This version fixes the actual failure mode:

- OCR runs in a dedicated child process (`utils.ocr_child`). A timeout SIGKILLs
  it, which genuinely returns the CPU. The next request lazily respawns it.
- The child is warmed once and reused, so the PaddleOCR model is loaded once
  per process rather than per request.
- A short `OCR_QUEUE_WAIT_SECONDS` bounded wait still applies: if no slot frees
  in time we skip OCR, store the photo, and let the user type the code
  manually. Upload availability never depends on OCR.
- A Redis lease makes OCR **cluster-wide** exclusive. Without it each gunicorn
  worker keeps its own warm child, i.e. three copies of the PaddleOCR model
  (~2 GB resident) and three concurrent sweeps on a 4-vCPU host shared with
  four other applications. With the lease only one worker warms a model and
  only one sweep runs at a time.

OCR is enrichment, never a gate: `run_ocr` never raises and never fails an
evidence-photo upload.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import struct
import sys
import time

from core.config import settings

log = logging.getLogger(__name__)

_LEN = struct.Struct(">I")
_CHILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ocr_child.py")
_LEASE_KEY = "bv:ocr:lease"

_CONCURRENCY = max(1, int(getattr(settings, "OCR_MAX_CONCURRENCY", 1)))
_WAIT_SECONDS = max(0.0, float(getattr(settings, "OCR_QUEUE_WAIT_SECONDS", 5.0)))
_TIMEOUT_SECONDS = max(1.0, float(getattr(settings, "OCR_TIMEOUT_SECONDS", 45.0)))
_LEASE_TTL_MS = max(1_000, int(_TIMEOUT_SECONDS * 1000) + 5_000)

_gate = asyncio.Semaphore(_CONCURRENCY)
_empty = {"text": "", "confidence": 0.0}

_child: asyncio.subprocess.Process | None = None
_child_lock = asyncio.Lock()
_kills = 0
_skips = 0
_lease_denials = 0
_redis = None


def ocr_runtime_info() -> dict:
    """Introspection for /health and load-test diagnostics."""
    return {
        "max_concurrency": _CONCURRENCY,
        "queue_wait_seconds": _WAIT_SECONDS,
        "timeout_seconds": _TIMEOUT_SECONDS,
        "at_capacity": _gate.locked(),
        "child_alive": bool(_child and _child.returncode is None),
        "child_kills": _kills,
        "skipped": _skips,
        "lease_denials": _lease_denials,
        "isolation": "subprocess",
    }


async def _get_redis():
    global _redis
    if _redis is None:
        from redis import asyncio as aioredis

        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def _acquire_lease() -> str | None:
    """Take the cluster-wide OCR lease, or return None if another worker has it.

    The token is also the lease value so we only release a lease we still own.
    """
    try:
        rc = await _get_redis()
        token = f"{os.getpid()}-{time.time_ns()}"
        # NX => only one worker across the whole deployment wins.
        if await rc.set(_LEASE_KEY, token, nx=True, px=_LEASE_TTL_MS):
            return token
        return None
    except Exception as exc:
        # Redis down must not take the app down. OCR is enrichment, so fall back
        # to running without the cross-worker gate: local bounds still apply.
        log.warning("ocr lease unavailable (%s: %s) — running without cross-worker gate",
                    type(exc).__name__, exc)
        return "no-lease"


async def _release_lease(token: str) -> None:
    try:
        rc = await _get_redis()
        # Compare-and-delete so we cannot drop a lease another worker took after
        # ours expired.
        await rc.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) "
            "else return 0 end",
            1,
            _LEASE_KEY,
            token,
        )
    except Exception:
        pass


async def _ensure_child() -> asyncio.subprocess.Process:
    """Spawn the OCR child if it is missing or dead, warming the model once."""
    global _child
    async with _child_lock:
        if _child is not None and _child.returncode is None:
            return _child
        if _child is not None:
            try:
                _child.kill()
            except ProcessLookupError:
                pass
            _child = None
        _child = await asyncio.create_subprocess_exec(
            sys.executable,
            _CHILD,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            # Own process group so a kill cannot leave orphaned tesseract forks
            # behind - the whole point of isolating OCR here.
            start_new_session=True,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        log.info("ocr child started pid=%s", _child.pid)
        return _child


async def _kill_child(reason: str) -> None:
    """SIGKILL the child (and its process group) so runaway CPU is reclaimed."""
    global _child, _kills
    proc, _child = _child, None
    if proc is None:
        return
    _kills += 1
    try:
        # Negative pid targets the process group created by start_new_session,
        # so forked `tesseract` children die with it.
        os.killpg(os.getpgid(proc.pid), 9)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    try:
        await asyncio.wait_for(proc.wait(), timeout=5.0)
    except (asyncio.TimeoutError, ProcessLookupError):
        pass
    log.warning("ocr child killed (%s) — CPU reclaimed", reason)


async def _read_exact(stream, count: int) -> bytes | None:
    chunks: list[bytes] = []
    remaining = count
    while remaining > 0:
        block = await stream.read(remaining)
        if not block:
            return None
        chunks.append(block)
        remaining -= len(block)
    return b"".join(chunks)


async def _call_child(proc: asyncio.subprocess.Process, data: bytes) -> dict:
    proc.stdin.write(_LEN.pack(len(data)))
    proc.stdin.write(data)
    await proc.stdin.drain()

    header = await _read_exact(proc.stdout, _LEN.size)
    if header is None:
        raise EOFError("ocr child closed the pipe")
    (length,) = _LEN.unpack(header)
    if length <= 0 or length > 8 * 1024 * 1024:
        raise ValueError(f"bad reply length {length}")
    payload = await _read_exact(proc.stdout, length)
    if payload is None:
        raise EOFError("truncated reply")
    return json.loads(payload.decode("utf-8"))


async def run_ocr(data: bytes) -> dict:
    """Run OCR on raw photo bytes. Never raises; always returns text/confidence."""
    global _skips, _lease_denials

    try:
        await asyncio.wait_for(_gate.acquire(), timeout=_WAIT_SECONDS)
    except asyncio.TimeoutError:
        _skips += 1
        log.warning(
            "ocr saturated: max_concurrency=%d wait=%.1fs — skipping OCR "
            "(photo still stored, code left for manual entry)",
            _CONCURRENCY, _WAIT_SECONDS,
        )
        return dict(_empty)

    lease = None
    try:
        lease = await _acquire_lease()
        if lease is None:
            # Another worker is already sweeping. Do not queue behind it: this
            # photo is stored either way and the code can be typed manually.
            _skips += 1
            _lease_denials += 1
            return dict(_empty)

        proc = await _ensure_child()
        try:
            reply = await asyncio.wait_for(_call_child(proc, data), timeout=_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            # This is the case the old thread-based design could not fix.
            await _kill_child(f"timeout after {_TIMEOUT_SECONDS:.0f}s")
            _skips += 1
            return dict(_empty)
        except (EOFError, ValueError, json.JSONDecodeError) as exc:
            # Child died or spoke nonsense; drop it and degrade this request.
            log.warning("ocr child failed (%s: %s) — skipping", type(exc).__name__, exc)
            await _kill_child(f"protocol error: {type(exc).__name__}")
            _skips += 1
            return dict(_empty)

        if reply.get("error"):
            log.warning("ocr engine error (%s) — skipping", reply["error"])
            _skips += 1
            return dict(_empty)
        return {
            "text": reply.get("text") or "",
            "confidence": float(reply.get("confidence") or 0.0),
        }
    except Exception as exc:  # noqa: BLE001 - enrichment must never fail upload
        log.warning("ocr skipped (%s: %s)", type(exc).__name__, exc)
        _skips += 1
        return dict(_empty)
    finally:
        if lease:
            await _release_lease(lease)
        _gate.release()


async def shutdown_ocr_runtime() -> None:
    """Kill the OCR child and its process group on application shutdown."""
    await _kill_child("shutdown")
    global _redis
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None