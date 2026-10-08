"""Worker to process the OCR queue asynchronously.

Runs OCR on the original high-resolution bytes stored in Redis and updates the
target VisitItAsset/VisitAsset row (sets code, ocr_raw, ocr_confirmed, status).
It uses the existing, bounded, killable OCR runtime, so the CPU-reclamation fix
carries over. This worker runs in its own process (a dedicated container reusing
the API image). The upload endpoint does not depend on it being alive - the
photo upload still succeeds even if Redis is down or the worker is offline.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import sys

# The image WORKDIR is /app and the package root is /app/app, so `core`/`models`/
# `utils` are importable as top-level packages from the API but not from
# `python -m app.workers...` unless that root is on the path.
_APP_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _APP_ROOT not in sys.path:
    sys.path.insert(0, _APP_ROOT)

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402

from core.database import engine  # noqa: E402
from models.asset import VisitAsset, VisitItAsset  # noqa: E402
from models.photo import Photo  # noqa: E402
from utils.audit import AuditLogger  # noqa: E402
from utils.ocr_queue import close_queue, dequeue_ocr  # noqa: E402
from utils.ocr_runtime import run_ocr, shutdown_ocr_runtime  # noqa: E402

log = logging.getLogger(__name__)
log.setLevel(logging.DEBUG)
import sys
if not log.handlers:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(h)
    log.propagate = False
log.setLevel(logging.DEBUG)
import sys
if not log.handlers:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(h)
    log.propagate = False

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def _get_target(session, target_kind: str, target_id):
    model = VisitItAsset if target_kind == "it_asset" else VisitAsset
    res = await session.execute(select(model).where(model.id == target_id))
    return res.scalar_one_or_none()


async def _process_one(job: dict) -> bool:
    job_id = job.get("id")
    target_kind = job["target_kind"]
    target_id = job["target_id"]
    photo_id = job.get("photo_id")
    try:
        data = base64.b64decode(job.get("bytes_b64") or "")
    except Exception as exc:
        log.warning("bad ocr job %s: %s", job_id, exc)
        return False

    async with AsyncSessionLocal() as session:
        try:
            target = await _get_target(session, target_kind, target_id)
            if target is None:
                # Row deleted or never committed (e.g. request rolled back after
                # enqueue). Nothing to enrich, so drop the job.
                log.info("ocr job %s targets missing %s/%s - dropping",
                         job_id, target_kind, target_id)
                return False

            photo = None
            if photo_id:
                res = await session.execute(select(Photo).where(Photo.id == photo_id))
                photo = res.scalar_one_or_none()

            ocr_res = await run_ocr(data)
            text = (ocr_res.get("text") or "").strip()
            conf = float(ocr_res.get("confidence") or 0.0)

            if photo is not None:
                target.code_photo_id = photo.id
            target.ocr_raw = text or None
            # Same trust rule the endpoint used when OCR ran inline: only
            # auto-fill a code that looks plate-like or is high confidence.
            code_like = bool(text) and ("/" in text or "-" in text or any(c.isdigit() for c in text))
            if text and (code_like or conf >= 70):
                target.code = text
                target.ocr_confirmed = conf >= 70
                if target.status in (None, "PENDING"):
                    target.status = "VERIFIED"

            await session.commit()

            await AuditLogger.log(
                session,
                user_id=job.get("user_id"),
                action="OCR_COMPLETED",
                entity_type="visit_it_asset" if target_kind == "it_asset" else "visit_asset",
                entity_id=target_id,
                details={
                    "photo_id": photo_id,
                    "text": text[:120],
                    "confidence": round(conf, 2),
                    "applied": bool(text),
                },
            )
            await session.commit()
            log.info("ocr job %s done: text=%r conf=%.0f", job_id, text, conf)
            return True
        except Exception as exc:
            await session.rollback()
            log.warning("ocr job %s failed (%s: %s)", job_id, type(exc).__name__, exc)
            return False


async def _loop():
    log.info("ocr queue worker started - listening on bv:ocr:jobs")
    try:
        while True:
            log.debug("waiting for job...")
            job = await dequeue_ocr(timeout=5)
            if job is None:
                log.debug("no job, continuing")
                continue
            log.info("received job %s for %s/%s", job.get("id"), job.get("target_kind"), job.get("target_id"))
            await _process_one(job)
    finally:
        await shutdown_ocr_runtime()
        await close_queue()


def main() -> None:
    print("ocr_worker main() starting", flush=True)
    try:
        asyncio.run(_loop())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()