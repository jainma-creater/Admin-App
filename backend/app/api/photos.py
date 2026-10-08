import hashlib
import io
import uuid
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.config import settings
from core.permissions import Permission
from api.deps import (
    get_current_user,
    get_current_user_query,
    require_permission,
    is_super_admin,
    can_access_branch,
)
from models.user import User
from models.visit import Visit, VisitAssignment, VisitChecklistItem
from models.photo import Photo
from models.misc import Notification
from utils.storage import (
    ensure_bucket,
    put_object,
    get_thumbnail_key,
    get_object_bytes,
    delete_object,
    is_postgres_mode,
    load_photo_blob,
    store_photo_blob,
)
from utils.audit import AuditLogger, utcnow
from utils.img_runtime import run_image_job
from schemas.photo import PhotoRead, PhotoWithDetails, PhotoRejectPayload

router = APIRouter(tags=["photos"])

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/heic-sequence"}


def _ensure_heif_support():
    """Register HEIF/HEIC decoder with Pillow (best-effort, requires pillow-heif)."""
    try:
        import pillow_heif  # noqa: F401

        pillow_heif.register_heif_opener()
    except ImportError:
        pass


_ensure_heif_support()


async def _photo_to_details(photo: Photo) -> PhotoWithDetails:
    item = PhotoWithDetails.model_validate(photo, from_attributes=True)
    item.uploader_name = photo.uploader.full_name if photo.uploader else None
    item.reviewer_name = photo.reviewer.full_name if (hasattr(photo, "reviewer") and photo.reviewer) else None
    # Provide direct streaming API URLs so all clients (LAN mobile devices, emulators, web) can reliably load images
    item.url = f"/api/v1/photos/{photo.id}/file"
    if photo.thumbnail_path:
        item.thumbnail_url = f"/api/v1/photos/{photo.id}/thumbnail"
    else:
        item.thumbnail_url = item.url
    if photo.visit and photo.visit.branch:
        item.branch_name = photo.visit.branch.name
        item.visit_date = photo.visit.submitted_at
    return item


def _encode_jpeg(img, quality: int) -> bytes:
    """Serialize a Pillow image as EXIF-free baseline JPEG."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, exif=b"")
    return buf.getvalue()


def _encode_webp(img, quality: int) -> bytes:
    """Serialize a Pillow image as EXIF-free WebP (better density than JPEG)."""
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality)
    return buf.getvalue()


def _encode_with_size_target(
    img,
    target_bytes: int,
    *,
    start_quality: int,
    min_quality: int,
    min_dimension: int = 640,
) -> tuple[bytes, str, int, int, int]:
    """Encode an image under a byte budget by walking quality (then size) down.

    Returns (bytes, mime, quality_used, width, height). Quality search is
    binary (bounded by min_quality); halving dimensions is the second lever so
    pathological, noisy images still converge instead of stalling at the floor.
    WebP wins whenever it encodes smaller than JPEG (it almost always does).
    """
    from PIL import Image

    if target_bytes <= 0:
        # Degenerate config: single pass at start quality, no search.
        return _encode_jpeg(img, start_quality), "image/jpeg", start_quality, img.width, img.height

    best: tuple[bytes, str, int, int, int] | None = None
    while True:
        lo, hi = min_quality, start_quality
        while lo <= hi:
            mid = (lo + hi) // 2
            jpeg = _encode_jpeg(img, mid)
            webp = _encode_webp(img, mid)
            if len(webp) < len(jpeg):
                candidate, mime, q = webp, "image/webp", mid
            else:
                candidate, mime, q = jpeg, "image/jpeg", mid
            if len(candidate) <= target_bytes:
                # Fits the budget — remember it, then try to climb quality.
                if best is None or q > best[2] or len(candidate) < len(best[0]):
                    best = (candidate, mime, q, img.width, img.height)
                lo = mid + 1
            else:
                hi = mid - 1
        if best is not None:
            return best
        if max(img.width, img.height) <= min_dimension:
            # Budget unreachable even at the floor: return the best-effort
            # min-quality encode rather than looping forever.
            jpeg = _encode_jpeg(img, min_quality)
            webp = _encode_webp(img, min_quality)
            if len(webp) < len(jpeg):
                return webp, "image/webp", min_quality, img.width, img.height
            return jpeg, "image/jpeg", min_quality, img.width, img.height
        img = img.resize((max(1, img.width // 2), max(1, img.height // 2)), Image.LANCZOS)


def _compress_image(data: bytes, mime: str) -> tuple[bytes, str, bytes | None]:
    """Compress image and produce a thumbnail. Returns (compressed_bytes, out_mime, thumbnail_bytes).

    Storage compression: evidence bytes are size-targeted (PHOTO_STORAGE_TARGET_KB)
    WebP/JPEG recompression with EXIF/GPS stripped and dimensions capped at
    PHOTO_STORAGE_MAX_DIMENSION. Uploads that already fit the budget pass through
    untouched when PHOTO_STORAGE_SKIP_IF_SMALLER is on, so tiny files are never
    degraded or grown. OCR on asset code plates runs on the ORIGINAL upload bytes
    in assets.py BEFORE this runs, so plate text is never hurt by compression.

    Hardening: bounding-box check *before* decoding (decompression-bomb/tile
    guard) and explicit EXIF/GPS strip so location metadata never survives in
    evidence bytes.
    """
    from PIL import Image, ImageOps

    # Cap Pillow's own decode-time decompression-bomb safety to our ceiling.
    Image.MAX_IMAGE_PIXELS = settings.MAX_IMAGE_PIXELS

    # Decompression bombs arrive as small files that explode in memory when
    # decoded. Reject oversized dimensions before calling img.load().
    try:
        probe = Image.open(io.BytesIO(data))
    except Exception:
        raise ValueError("invalid image")
    w, h = probe.size
    if max(w, h) > settings.MAX_IMAGE_DIMENSION or (w * h) > settings.MAX_IMAGE_PIXELS:
        probe.close()
        raise ValueError("image dimensions too large")
    probe.close()

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        raise ValueError("invalid image")

    if img.mode in ("RGBA", "P", "LA"):
        try:
            img = img.convert("RGB")
        except Exception:
            pass

    # Orientation handling
    try:
        ImageOps.exif_transpose(img, in_place=True)
    except Exception:
        pass

    # Evidence bytes must not carry GPS/EXIF metadata about who/when/where the
    # photo was taken beyond what the app already records explicitly.
    img.info.pop("exif", None)

    max_dim = settings.PHOTO_STORAGE_MAX_DIMENSION
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    # WebP (and legacy JPEG) both need an RGB source; CMYK/Lab scans or
    # 16-bit PNGs must be flattened before encoding.
    if img.mode not in ("RGB", "L"):
        try:
            img = img.convert("RGB")
        except Exception:
            pass

    target = settings.PHOTO_STORAGE_TARGET_KB * 1024

    # Already-small fast path: never grow or degrade an upload that already
    # fits the storage budget at its current dimensions. Only browser-native
    # formats qualify — HEIC/HEIF is always re-encoded so every client can
    # render the evidence — and only when the file carries no EXIF/GPS
    # metadata, which must never survive into stored evidence.
    if (
        settings.PHOTO_STORAGE_SKIP_IF_SMALLER
        and mime.lower() in ("image/jpeg", "image/png", "image/webp")
        and len(data) <= target
        and max(img.width, img.height) <= max_dim
        and not img.info.get("exif")
        and not len(img.getexif())
    ):
        thumbnail = _make_thumbnail(img)
        return data, mime, thumbnail

    compressed, out_mime, _q, _w, _h = _encode_with_size_target(
        img,
        target,
        start_quality=settings.PHOTO_QUALITY,
        min_quality=settings.PHOTO_STORAGE_MIN_QUALITY,
    )

    thumbnail = _make_thumbnail(img)
    return compressed, out_mime, thumbnail


def _make_thumbnail(img) -> bytes:
    """200px JPEG preview used by gallery grids and evidence cards."""
    from PIL import Image

    thumb = img.copy()
    thumb.thumbnail((settings.THUMBNAIL_SIZE, settings.THUMBNAIL_SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    thumb.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


async def _resolve_checklist_item(db: AsyncSession, visit: Visit, checklist_item_id: str | None) -> UUID | None:
    """Resolve a client-supplied checklist_item_id into the *per-visit* VisitChecklistItem id.

    Accepts either the VisitChecklistItem.id or the template ChecklistItem.id.
    Returns None when absent/unresolvable (never raises)."""
    if not checklist_item_id or not str(checklist_item_id).strip():
        return None
    raw = str(checklist_item_id).strip().lower()
    if raw in ("null", "undefined"):
        return None
    try:
        raw_uuid = UUID(raw)
    except ValueError:
        return None

    # Direct match to VisitChecklistItem for this visit
    v_check = await db.execute(
        select(VisitChecklistItem.id).where(
            VisitChecklistItem.id == raw_uuid,
            VisitChecklistItem.visit_id == visit.id,
        )
    )
    matched = v_check.scalars().first()
    if matched:
        return matched

    # Template ChecklistItem ID -> resolve to per-visit item(s) for this visit (all same value)
    v_by_tpl = await db.execute(
        select(VisitChecklistItem.id).where(
            VisitChecklistItem.checklist_item_id == raw_uuid,
            VisitChecklistItem.visit_id == visit.id,
        )
    )
    return v_by_tpl.scalars().first()


async def store_visit_photo(
    db: AsyncSession,
    visit: Visit,
    current_user: User,
    file: UploadFile,
    *,
    checklist_item_id: str | None = None,
    caption: str | None = None,
    asset_id: UUID | None = None,
    it_asset_row_id: UUID | None = None,
    device_id: str | None = None,
    client_photo_id: str | None = None,
) -> Photo:
    """Shared photo pipeline: validate -> compress -> persist (postgres bytea or
    object storage) -> audit. Used by the generic upload endpoint and the
    per-asset / per-IT-row evidence uploads.

    When the client supplies both a device id and a client-generated photo id
    (X-Device-Id / X-Idempotency-Key), the write is idempotent: a retry with
    the same key returns the already-stored evidence instead of creating a
    duplicate row. This is what makes offline sync safe over flaky links."""
    # Size gate BEFORE reading the whole body into memory
    if file.size is not None and file.size > settings.MAX_PHOTO_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")

    content_type = file.content_type or "image/jpeg"
    if content_type.lower() not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Unsupported image type")

    # Idempotent replay: same device + id already stored for this visit.
    if device_id and client_photo_id:
        existing = await db.scalar(
            select(Photo).where(
                Photo.visit_id == visit.id,
                Photo.device_id == device_id,
                Photo.client_photo_id == client_photo_id,
            )
        )
        if existing:
            return existing

    data = await file.read()
    if len(data) > settings.MAX_PHOTO_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")

    ci_uuid = await _resolve_checklist_item(db, visit, checklist_item_id)

    try:
        compressed, out_mime, thumbnail = await run_image_job(_compress_image, data, content_type)
    except ValueError as e:
        # Surface the specific reason ("image dimensions too large") while
        # keeping other decode failures generic.
        detail = str(e) if str(e) not in ("", "invalid image") else "Invalid image file"
        raise HTTPException(status_code=400, detail=detail)

    pg_mode = is_postgres_mode()

    key: str | None = None
    thumb_key: str | None = None
    if not pg_mode:
        ensure_bucket()
        prefix = f"visits/{visit.id}"
        try:
            key, _ = await anyio.to_thread.run_sync(put_object, compressed, out_mime, prefix)
        except Exception:
            raise HTTPException(status_code=503, detail="Photo storage unavailable, please try again")

        if thumbnail:
            try:
                thumb_key, _ = await anyio.to_thread.run_sync(put_object, thumbnail, "image/jpeg", prefix)
            except Exception:
                thumb_key = None

    photo = Photo(
        visit_id=visit.id,
        checklist_item_id=ci_uuid,
        asset_id=asset_id,
        it_asset_row_id=it_asset_row_id,
        uploaded_by=current_user.id,
        device_id=device_id,
        client_photo_id=client_photo_id,
        storage_path=key or f"postgres://{uuid.uuid4()}",
        original_filename=file.filename,
        thumbnail_path=thumb_key or (None if pg_mode else get_thumbnail_key(key)),
        file_hash=hashlib.sha256(compressed).hexdigest(),
        file_size=len(compressed),
        mime_type=out_mime,
        caption=caption,
    )
    db.add(photo)
    try:
        await db.flush()
    except Exception:
        # DB row failed; don't leave an orphaned object behind
        if key:
            await anyio.to_thread.run_sync(delete_object, key)
        if thumb_key:
            await anyio.to_thread.run_sync(delete_object, thumb_key)
        raise

    if pg_mode:
        photo.storage_path = f"postgres://{photo.id}"
        await store_photo_blob(db, photo.id, compressed, out_mime, thumbnail)
        await db.flush()

    await AuditLogger.log(db, user_id=current_user.id,
                          action="PHOTO_UPLOADED", entity_type="visit", entity_id=visit.id,
                          details={"photo_id": str(photo.id)})
    return photo


@router.post("/visits/{visit_id}/photos", response_model=PhotoRead, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    visit_id: UUID,
    file: UploadFile = File(...),
    checklist_item_id: str | None = Form(None),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    gps_enabled: bool = Form(True),
    caption: str | None = Form(None),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    x_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Visit).where(Visit.id == visit_id).options(selectinload(Visit.branch)))
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    if not can_access_branch(current_user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")

    photo = await store_visit_photo(
        db, visit, current_user, file,
        checklist_item_id=checklist_item_id,
        caption=caption,
        device_id=x_device_id,
        client_photo_id=x_idempotency_key,
    )
    photo.latitude = latitude
    photo.longitude = longitude
    photo.gps_enabled = gps_enabled
    return photo


@router.get("/visits/{visit_id}/photos", response_model=list[PhotoWithDetails])
async def list_photos(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Photo)
        .options(
            selectinload(Photo.uploader),
            # _photo_to_details reads photo.visit.branch — without this eager
            # load asyncio raises MissingGreenlet on lazy load (HTTP 500).
            selectinload(Photo.visit).selectinload(Visit.branch),
        )
        .where(Photo.visit_id == visit_id)
        .order_by(Photo.created_at.desc())
    )
    photos = result.scalars().all()
    out = []
    for p in photos:
        out.append(await _photo_to_details(p))
    return out


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(
    photo_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a photo (uploader, admin or super admin)."""
    result = await db.execute(select(Photo).where(Photo.id == photo_id))
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    if not (is_super_admin(current_user) or photo.uploaded_by == current_user.id):
        raise HTTPException(status_code=403, detail="Not allowed to delete this photo")

    to_delete = [photo.storage_path, photo.thumbnail_path]
    photo_id_str = str(photo.id)
    visit_id = photo.visit_id

    # DB row is the source of truth: remove the row first (photo_blobs cascades
    # via FK), then best-effort clean object storage (skipped in postgres mode).
    await db.delete(photo)
    await db.flush()
    if not is_postgres_mode():
        for key in to_delete:
            if key:
                try:
                    await anyio.to_thread.run_sync(delete_object, key)
                except Exception:
                    pass

    await AuditLogger.log(db, user_id=current_user.id,
                          action="PHOTO_DELETED", entity_type="visit",
                          entity_id=visit_id,
                          details={"photo_id": photo_id_str})
    return None


@router.get("/photos", response_model=list[PhotoWithDetails])
async def gallery(
    branch_id: UUID | None = None,
    checklist_item_id: UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(require_permission(Permission.READ_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Photo)
        .options(selectinload(Photo.uploader), selectinload(Photo.visit).selectinload(Visit.branch))
        .order_by(Photo.created_at.desc())
        .limit(limit)
    )
    if branch_id:
        stmt = stmt.where(Photo.visit.has(Visit.branch_id == branch_id))
    if checklist_item_id:
        stmt = stmt.where(Photo.checklist_item_id == checklist_item_id)
    if status_filter:
        stmt = stmt.where(
            Photo.checklist_item_id.in_(
                select(VisitChecklistItem.id).where(VisitChecklistItem.status == status_filter)
            )
        )

    result = await db.execute(stmt)
    photos = result.scalars().all()
    out = []
    for p in photos:
        out.append(await _photo_to_details(p))
    return out


@router.get("/photos/{photo_id}", response_model=PhotoWithDetails)
async def get_photo(
    photo_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Photo)
        .options(
            selectinload(Photo.uploader),
            selectinload(Photo.reviewer),
            selectinload(Photo.visit).selectinload(Visit.branch),
        )
        .where(Photo.id == photo_id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    return await _photo_to_details(photo)


@router.post("/photos/{photo_id}/reject", response_model=PhotoWithDetails)
async def reject_photo(
    photo_id: UUID,
    payload: PhotoRejectPayload,
    current_user=Depends(require_permission(Permission.REVIEW_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    """Flag / reject an evidence photo for quality issues (Blurry, Not visible, Wrong photo, etc.).
    Triggers a notification to the inspector / uploader so they are notified on mobile to retake the photo."""
    result = await db.execute(
        select(Photo)
        .options(
            selectinload(Photo.uploader),
            selectinload(Photo.reviewer),
            selectinload(Photo.visit).selectinload(Visit.branch),
        )
        .where(Photo.id == photo_id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    reason_str = payload.reason.strip()
    if payload.notes and payload.notes.strip():
        full_reason = f"{reason_str}: {payload.notes.strip()}"
    else:
        full_reason = reason_str

    photo.status = "REJECTED"
    photo.rejection_reason = full_reason[:255]
    photo.reviewed_by = current_user.id
    photo.reviewed_at = utcnow()

    # Create notifications for uploader and assigned inspectors
    branch_name = photo.visit.branch.name if (photo.visit and photo.visit.branch) else "Branch"
    target_user_ids = set()
    if photo.uploaded_by:
        target_user_ids.add(photo.uploaded_by)

    if photo.visit_id:
        v_res = await db.execute(
            select(Visit)
            .options(selectinload(Visit.assignments))
            .where(Visit.id == photo.visit_id)
        )
        visit_obj = v_res.scalar_one_or_none()
        if visit_obj:
            if visit_obj.created_by:
                target_user_ids.add(visit_obj.created_by)
            for a in (visit_obj.assignments or []):
                if a.user_id:
                    target_user_ids.add(a.user_id)

    if not target_user_ids and current_user:
        target_user_ids.add(current_user.id)

    for uid in target_user_ids:
        notif = Notification(
            user_id=uid,
            title=f"Photo Rejected ({reason_str})",
            body=f"Evidence photo at {branch_name} was rejected: '{full_reason}'. Please open the visit and retake clear photo evidence.",
            type="PHOTO_REJECTED",
            entity_type="visit",
            entity_id=str(photo.visit_id),
            is_read=False,
        )
        db.add(notif)

    await db.flush()
    await AuditLogger.log(
        db,
        user_id=current_user.id,
        action="PHOTO_REJECTED",
        entity_type="photo",
        entity_id=photo.id,
        details={
            "visit_id": str(photo.visit_id),
            "reason": reason_str,
            "notes": payload.notes,
        },
    )
    return await _photo_to_details(photo)


@router.post("/photos/{photo_id}/approve", response_model=PhotoWithDetails)
async def approve_photo(
    photo_id: UUID,
    current_user=Depends(require_permission(Permission.REVIEW_VISIT)),
    db: AsyncSession = Depends(get_db),
):
    """Approve a photo as valid evidence."""
    result = await db.execute(
        select(Photo)
        .options(
            selectinload(Photo.uploader),
            selectinload(Photo.reviewer),
            selectinload(Photo.visit).selectinload(Visit.branch),
        )
        .where(Photo.id == photo_id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    photo.status = "ACCEPTED"
    photo.rejection_reason = None
    photo.reviewed_by = current_user.id
    photo.reviewed_at = utcnow()

    await db.flush()
    await AuditLogger.log(
        db,
        user_id=current_user.id,
        action="PHOTO_APPROVED",
        entity_type="photo",
        entity_id=photo.id,
        details={"visit_id": str(photo.visit_id)},
    )
    return await _photo_to_details(photo)


async def _load_photo_bytes(db: AsyncSession, photo_id: UUID, thumb: bool) -> tuple[bytes, str, str] | None:
    result = await db.execute(select(Photo).where(Photo.id == photo_id))
    photo = result.scalar_one_or_none()
    if not photo:
        return None

    if is_postgres_mode():
        blob = await load_photo_blob(db, photo_id)
        if blob:
            data_b, thumbnail_b, mime = blob
            data = thumbnail_b if (thumb and thumbnail_b) else data_b
            if data:
                return data, mime, (photo.original_filename or f"photo-{photo_id}.jpg")
        # No DB blob yet (legacy photo stored in MinIO/S3) — fall through to
        # object storage so old evidence keeps rendering after mode switch.

    path = (photo.thumbnail_path if thumb else photo.storage_path) or photo.storage_path
    if not path:
        return None
    data = await anyio.to_thread.run_sync(get_object_bytes, path)
    if not data and not thumb and photo.storage_path:
        return None
    if not data and thumb and photo.storage_path and photo.storage_path != path:
        data = await anyio.to_thread.run_sync(get_object_bytes, photo.storage_path)
    if not data:
        return None
    bytes_, ctype = data
    return bytes_, ctype, (photo.original_filename or f"photo-{photo_id}.jpg")


@router.get("/photos/{photo_id}/checksum")
async def photo_checksum(
    photo_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Evidence-integrity check: recompute SHA-256 from the bytes at rest and
    compare against the hash recorded at upload time.

    A mismatched hash means the stored evidence was altered or corrupted
    outside the app's write path (tamper evidence).
    """
    result = await db.execute(
        select(Photo).options(selectinload(Photo.visit).selectinload(Visit.branch)).where(Photo.id == photo_id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    branch = photo.visit.branch if photo.visit else None
    if not can_access_branch(current_user, branch):
        raise HTTPException(status_code=403, detail="Access denied")

    data: bytes | None = None
    if is_postgres_mode():
        blob = await load_photo_blob(db, photo.id)
        if blob:
            data = blob[0]
    if data is None:
        stored = await anyio.to_thread.run_sync(get_object_bytes, photo.storage_path)
        data = stored[0] if stored else None
    if data is None:
        raise HTTPException(status_code=404, detail="Image data not found")

    recomputed = hashlib.sha256(data).hexdigest()
    verified = recomputed == photo.file_hash

    await AuditLogger.log(
        db, user_id=current_user.id, action="PHOTO_CHECKSUM_VERIFIED",
        entity_type="photo", entity_id=photo.id,
        details={"photo_id": str(photo.id), "verified": verified},
    )

    return {
        "photo_id": str(photo.id),
        "stored_sha256": photo.file_hash,
        "recomputed_sha256": recomputed,
        "verified": verified,
        "mime_type": photo.mime_type,
        "file_size": photo.file_size,
    }


@router.get("/photos/{photo_id}/file")
async def get_photo_file(
    photo_id: UUID,
    download: bool = Query(False, description="Force browser download instead of inline display"),
    current_user=Depends(get_current_user_query),
    db: AsyncSession = Depends(get_db),
):
    """Directly stream raw photo image data with browser/app caching.

    ?download=1 switches Content-Disposition to 'attachment' so <a download>
    links save the evidence file instead of opening a tab."""
    res = await _load_photo_bytes(db, photo_id, thumb=False)
    if not res:
        raise HTTPException(status_code=404, detail="Photo not found")

    data, content_type, filename = res
    safe_filename = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_"))
    final_name = safe_filename or f"photo-{photo_id}.jpg"
    if not final_name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".heic")):
        final_name = f"{final_name}.jpg"
    # Recompressed evidence may be WebP while original_filename still says
    # .jpg/.png — keep the downloaded extension truthful so OSes/openers
    # handle the file correctly.
    if content_type == "image/webp" and not final_name.lower().endswith(".webp"):
        final_name = final_name.rsplit(".", 1)[0] + ".webp"
    disposition = "attachment" if download else "inline"
    return Response(
        content=data,
        media_type=content_type or "image/jpeg",
        headers={
            "Cache-Control": "public, max-age=86400, immutable",
            "Content-Disposition": f'{disposition}; filename="{final_name}"',
        },
    )


@router.get("/photos/{photo_id}/thumbnail")
async def get_photo_thumbnail(
    photo_id: UUID,
    current_user=Depends(get_current_user_query),
    db: AsyncSession = Depends(get_db),
):
    """Directly stream photo thumbnail data."""
    res = await _load_photo_bytes(db, photo_id, thumb=True)
    if not res:
        raise HTTPException(status_code=404, detail="Image data not found")

    data, _ctype, _filename = res
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )