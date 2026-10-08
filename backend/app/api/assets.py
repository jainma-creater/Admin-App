import uuid
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from core.database import get_db
from api.deps import can_access_branch, get_current_user
from api.photos import _compress_image, ALLOWED_MIME, store_visit_photo
from models.asset import ItAssetType, VisitAsset, VisitItAsset, Employee
from models.photo import Photo
from models.user import User
from models.visit import Visit
from schemas.asset import (
    OcScanResult,
    PhotoRef,
    VisitAssetCreate,
    VisitAssetRead,
    VisitAssetUpdate,
    VisitItAssetRead,
    VisitItAssetUpdate,
)
from utils.audit import AuditLogger
from utils.img_runtime import run_image_job
from utils.ocr_queue import enqueue_ocr
from utils.storage import (
    delete_object,
    ensure_bucket,
    get_thumbnail_key,
    put_object,
    is_postgres_mode,
    store_photo_blob,
)

router = APIRouter(tags=["assets"])

PHOTO_FIELDS = ("code_photo_id", "photo_url", "photo_thumbnail_url")


def _attach_photo_refs(obj: dict):
    photo_id = obj.get("code_photo_id")
    obj["photo_url"] = f"/api/v1/photos/{photo_id}/file" if photo_id else None
    obj["photo_thumbnail_url"] = f"/api/v1/photos/{photo_id}/thumbnail" if photo_id else None


def _photo_ref(photo: Photo) -> PhotoRef:
    return PhotoRef(
        id=photo.id,
        photo_url=f"/api/v1/photos/{photo.id}/file",
        photo_thumbnail_url=f"/api/v1/photos/{photo.id}/thumbnail",
        captured_at=photo.captured_at or photo.created_at,
    )


async def _load_photo_map(db: AsyncSession, id_attr, ids: list) -> dict:
    """Batch-load photos for many parents. Returns {parent_id: [Photo, ...]}."""
    clean = [i for i in ids if i is not None]
    if not clean:
        return {}
    result = await db.execute(
        select(Photo).where(id_attr.in_(clean)).order_by(Photo.created_at)
    )
    mapping: dict = {}
    for p in result.scalars().all():
        key = getattr(p, id_attr.key)
        if key is not None:
            mapping.setdefault(str(key), []).append(p)
    return mapping


async def _get_visit(db: AsyncSession, visit_id: UUID, user: User) -> Visit:
    result = await db.execute(
        select(Visit).where(Visit.id == visit_id).options(selectinload(Visit.branch))
    )
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not can_access_branch(user, visit.branch):
        raise HTTPException(status_code=403, detail="Access denied")
    return visit


async def _capture_code_photo(db, user, visit, target, file: UploadFile) -> OcScanResult:
    """Shared photo + OCR flow used by fixed & IT asset code plates."""
    if file.size is not None and file.size > settings.MAX_PHOTO_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")

    content_type = file.content_type or "image/jpeg"
    if content_type.lower() not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Unsupported image type")

    data = await file.read()
    if len(data) > settings.MAX_PHOTO_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")

    # Store the photo and return immediately. OCR is enrichment, not a gate: run it
    # asynchronously on the queue so a scan is never blocked behind a ~20-25s
    # inference. The code is auto-filled when the worker finishes; until then it
    # stays null for the user to type, which is the documented degradation.
    try:
        compressed, out_mime, thumbnail = await run_image_job(
            _compress_image, data, content_type
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

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
        uploaded_by=user.id,
        storage_path=key or f"postgres://{uuid.uuid4()}",
        original_filename=file.filename,
        thumbnail_path=thumb_key or (None if pg_mode else get_thumbnail_key(key)),
        file_size=len(compressed),
        mime_type=out_mime,
        caption="Asset code plate",
    )
    if isinstance(target, VisitAsset):
        photo.asset_id = target.id
    elif isinstance(target, VisitItAsset):
        photo.it_asset_row_id = target.id
    db.add(photo)
    try:
        await db.flush()
    except Exception:
        if key:
            await anyio.to_thread.run_sync(delete_object, key)
        if thumb_key:
            await anyio.to_thread.run_sync(delete_object, thumb_key)
        raise

    if pg_mode:
        photo.storage_path = f"postgres://{photo.id}"
        await store_photo_blob(db, photo.id, compressed, out_mime, thumbnail)
        await db.flush()

    target.code_photo_id = photo.id
    target.ocr_raw = None
    # Hand the ORIGINAL full-resolution bytes to the queue. The compressed copy
    # is what we persist for viewing, but it loses the small plate text OCR needs.
    # If the queue is unavailable or full this is a no-op: the photo is already
    # stored and the user types the code manually.
    queued = await enqueue_ocr(
        photo_id=str(photo.id),
        target_kind="it_asset" if isinstance(target, VisitItAsset) else "asset",
        target_id=str(target.id),
        visit_id=str(visit.id),
        user_id=str(user.id),
        data=data,
    )
    await db.flush()

    await AuditLogger.log(
        db,
        user_id=user.id,
        action="PHOTO_UPLOADED",
        entity_type="visit",
        entity_id=visit.id,
        details={"photo_id": str(photo.id), "asset_id": str(target.id)},
    )
    return OcScanResult(
        code_photo_id=photo.id,
        ocr_text="",
        ocr_confidence=0.0,
        ocr_pending=queued,
    )


# --------------------------------------------------------------------------
# Fixed assets
# --------------------------------------------------------------------------
@router.get("/visits/{visit_id}/assets", response_model=list[VisitAssetRead])
async def list_visit_assets(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_visit(db, visit_id, current_user)
    result = await db.execute(
        select(VisitAsset)
        .options(
            selectinload(VisitAsset.creator),
            selectinload(VisitAsset.photos),
        )
        .where(VisitAsset.visit_id == visit_id)
        .order_by(VisitAsset.sort_order, VisitAsset.created_at)
    )
    assets = result.scalars().all()
    photo_map = await _load_photo_map(db, Photo.asset_id, [a.id for a in assets])
    out = []
    for a in assets:
        item = VisitAssetRead.model_validate(a, from_attributes=True)
        item.created_by_name = a.creator.full_name if a.creator else None
        _attach_photo_refs(item.__dict__)
        item.photos = [_photo_ref(p) for p in photo_map.get(str(a.id), [])]
        out.append(item)
    return out


@router.post(
    "/visits/{visit_id}/assets",
    response_model=VisitAssetRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_visit_asset(
    visit_id: UUID,
    payload: VisitAssetCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    visit = await _get_visit(db, visit_id, current_user)
    created = await db.scalar(
        select(VisitAsset).where(VisitAsset.visit_id == visit_id).order_by(VisitAsset.sort_order.desc())
    )
    asset = VisitAsset(
        visit_id=visit.id,
        category=payload.category.strip(),
        name=payload.name,
        code=payload.code,
        status=payload.status,
        sort_order=(created.sort_order + 1) if created else 0,
        created_by=current_user.id,
    )
    db.add(asset)
    await db.flush()
    await db.refresh(asset, attribute_names=["photos"])
    item = VisitAssetRead.model_validate(asset, from_attributes=True)
    item.created_by_name = current_user.full_name
    _attach_photo_refs(item.__dict__)
    item.photos = []
    return item


@router.patch("/visits/{visit_id}/assets/{asset_id}", response_model=VisitAssetRead)
async def update_visit_asset(
    visit_id: UUID,
    asset_id: UUID,
    payload: VisitAssetUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_visit(db, visit_id, current_user)
    asset = await db.scalar(
        select(VisitAsset)
        .options(selectinload(VisitAsset.photos))
        .where(VisitAsset.id == asset_id, VisitAsset.visit_id == visit_id)
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    await db.flush()
    item = VisitAssetRead.model_validate(asset, from_attributes=True)
    _attach_photo_refs(item.__dict__)
    photo_map = await _load_photo_map(db, Photo.asset_id, [asset.id])
    item.photos = [_photo_ref(p) for p in photo_map.get(str(asset.id), [])]
    return item


@router.delete("/visits/{visit_id}/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_visit_asset(
    visit_id: UUID,
    asset_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_visit(db, visit_id, current_user)
    asset = await db.scalar(
        select(VisitAsset).where(VisitAsset.id == asset_id, VisitAsset.visit_id == visit_id)
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    await db.delete(asset)
    await db.flush()
    return None


@router.post(
    "/visits/{visit_id}/assets/{asset_id}/code-photo", response_model=OcScanResult
)
async def upload_fixed_asset_code_photo(
    visit_id: UUID,
    asset_id: UUID,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    visit = await _get_visit(db, visit_id, current_user)
    asset = await db.scalar(
        select(VisitAsset).where(VisitAsset.id == asset_id, VisitAsset.visit_id == visit_id)
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return await _capture_code_photo(db, current_user, visit, asset, file)


@router.get("/visits/{visit_id}/assets/{asset_id}/photos", response_model=list[PhotoRef])
async def list_asset_photos(
    visit_id: UUID,
    asset_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_visit(db, visit_id, current_user)
    asset = await db.scalar(
        select(VisitAsset).where(VisitAsset.id == asset_id, VisitAsset.visit_id == visit_id)
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    photo_map = await _load_photo_map(db, Photo.asset_id, [asset.id])
    return [_photo_ref(p) for p in photo_map.get(str(asset.id), [])]


@router.post(
    "/visits/{visit_id}/assets/{asset_id}/photos",
    response_model=PhotoRef,
    status_code=status.HTTP_201_CREATED,
)
async def upload_asset_photo(
    visit_id: UUID,
    asset_id: UUID,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    x_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Attach another evidence photo to a fixed asset (any number, no OCR)."""
    visit = await _get_visit(db, visit_id, current_user)
    asset = await db.scalar(
        select(VisitAsset).where(VisitAsset.id == asset_id, VisitAsset.visit_id == visit_id)
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    photo = await store_visit_photo(
        db, visit, current_user, file,
        asset_id=asset.id,
        caption=caption or f"{asset.category} photo",
        device_id=x_device_id,
        client_photo_id=x_idempotency_key,
    )
    # First photo becomes the card thumbnail/primary until a code-plate OCR photo
    # replaces it (code_photo_id is the primary slot).
    if asset.code_photo_id is None:
        asset.code_photo_id = photo.id
        await db.flush()
    return _photo_ref(photo)


# --------------------------------------------------------------------------
# IT asset verification (per visit / employee / asset type)
# --------------------------------------------------------------------------
async def _ensure_expected_rows(db, visit: Visit, user: User) -> None:
    """Pre-create VisitItAsset rows for this visit for every active employee
    of the visit's branch and every active ItAssetType (idempotent)."""
    staff = (
        await db.execute(
            select(Employee).where(
                Employee.branch_id == visit.branch_id,
                Employee.is_active.is_(True),
            )
        )
    ).scalars().all()
    types = (
        await db.execute(
            select(ItAssetType).where(ItAssetType.is_active.is_(True)).order_by(ItAssetType.sort_order)
        )
    ).scalars().all()
    if not staff or not types:
        return

    existing = (
        await db.execute(
            select(VisitItAsset).where(VisitItAsset.visit_id == visit.id)
        )
    ).scalars().all()
    seen = {(r.employee_id, r.asset_type_id) for r in existing}
    new_rows = [
        VisitItAsset(
            visit_id=visit.id,
            employee_id=emp.id,
            asset_type_id=t.id,
            created_by=user.id,
        )
        for emp in staff
        for t in types
        if (emp.id, t.id) not in seen
    ]
    if new_rows:
        db.add_all(new_rows)
        # Flush now so every row below (including ones the phone is about to
        # PATCH) has a stable DB id in this request's transaction.
        await db.flush()


@router.get("/visits/{visit_id}/it-assets", response_model=list[VisitItAssetRead])
async def list_visit_it_assets(
    visit_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    visit = await _get_visit(db, visit_id, current_user)
    await _ensure_expected_rows(db, visit, current_user)
    result = await db.execute(
        select(VisitItAsset)
        .options(
            selectinload(VisitItAsset.employee),
            selectinload(VisitItAsset.asset_type),
            selectinload(VisitItAsset.photos),
        )
        .where(VisitItAsset.visit_id == visit_id)
        .order_by(VisitItAsset.employee_id)
    )
    rows = sorted(
        result.scalars().all(),
        # Group by employee ALPHABETICALLY (uuid order shuffled cards on the
        # phone, making it easy to scan the wrong employee's asset), then by
        # the type's display order.
        key=lambda r: (
            (r.employee.name or "").lower() if r.employee else "",
            r.employee.emp_code if r.employee else "",
            r.asset_type.sort_order if r.asset_type else 999,
        ),
    )
    photo_map = await _load_photo_map(db, Photo.it_asset_row_id, [r.id for r in rows])
    out = []
    for r in rows:
        item = VisitItAssetRead.model_validate(r, from_attributes=True)
        item.employee_code = r.employee.emp_code if r.employee else None
        item.employee_name = r.employee.name if r.employee else None
        item.department = r.employee.department if r.employee else None
        item.asset_type_name = r.asset_type.name if r.asset_type else None
        _attach_photo_refs(item.__dict__)
        item.photos = [_photo_ref(p) for p in photo_map.get(str(r.id), [])]
        out.append(item)
    return out


@router.patch("/visits/{visit_id}/it-assets/{row_id}", response_model=VisitItAssetRead)
async def update_visit_it_asset(
    visit_id: UUID,
    row_id: UUID,
    payload: VisitItAssetUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_visit(db, visit_id, current_user)
    row = await db.scalar(
        select(VisitItAsset)
        .options(
            selectinload(VisitItAsset.employee),
            selectinload(VisitItAsset.asset_type),
            selectinload(VisitItAsset.photos),
        )
        .where(VisitItAsset.id == row_id, VisitItAsset.visit_id == visit_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="IT asset row not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("status") == "NOT_FOUND":
        remark = (data.get("remark") or "").strip()
        if not remark:
            raise HTTPException(status_code=422, detail="Remark is required when the asset is not found")
        data["remark"] = remark
        data["code"] = None
        data["ocr_raw"] = None
        data["ocr_confirmed"] = False
    else:
        code = data.get("code")
        if code is not None and str(code).strip():
            data["status"] = "VERIFIED"
            data["remark"] = ""
        elif data.get("status") == "PENDING":
            data["remark"] = ""
    for field, value in data.items():
        setattr(row, field, value)
    await db.flush()
    item = VisitItAssetRead.model_validate(row, from_attributes=True)
    item.employee_code = row.employee.emp_code if row.employee else None
    item.employee_name = row.employee.name if row.employee else None
    item.department = row.employee.department if row.employee else None
    item.asset_type_name = row.asset_type.name if row.asset_type else None
    _attach_photo_refs(item.__dict__)
    photo_map = await _load_photo_map(db, Photo.it_asset_row_id, [row.id])
    item.photos = [_photo_ref(p) for p in photo_map.get(str(row.id), [])]
    return item


@router.post("/visits/{visit_id}/it-assets/{row_id}/code-photo", response_model=OcScanResult)
async def upload_it_asset_code_photo(
    visit_id: UUID,
    row_id: UUID,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    visit = await _get_visit(db, visit_id, current_user)
    row = await db.scalar(
        select(VisitItAsset).where(VisitItAsset.id == row_id, VisitItAsset.visit_id == visit_id)
    )
    if not row:
        # A stale list (rows pre-created by another device after this phone
        # fetched its copy) must not fail the scan — materialize and retry.
        await _ensure_expected_rows(db, visit, current_user)
        row = await db.scalar(
            select(VisitItAsset).where(VisitItAsset.id == row_id, VisitItAsset.visit_id == visit_id)
        )
    if not row:
        raise HTTPException(status_code=404, detail="IT asset row not found")
    return await _capture_code_photo(db, current_user, visit, row, file)


@router.get("/visits/{visit_id}/it-assets/{row_id}/photos", response_model=list[PhotoRef])
async def list_it_asset_photos(
    visit_id: UUID,
    row_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_visit(db, visit_id, current_user)
    row = await db.scalar(
        select(VisitItAsset).where(VisitItAsset.id == row_id, VisitItAsset.visit_id == visit_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="IT asset row not found")
    photo_map = await _load_photo_map(db, Photo.it_asset_row_id, [row.id])
    return [_photo_ref(p) for p in photo_map.get(str(row.id), [])]


@router.post(
    "/visits/{visit_id}/it-assets/{row_id}/photos",
    response_model=PhotoRef,
    status_code=status.HTTP_201_CREATED,
)
async def upload_it_asset_photo(
    visit_id: UUID,
    row_id: UUID,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    x_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Attach another evidence photo to an IT asset row (any number, no OCR)."""
    visit = await _get_visit(db, visit_id, current_user)
    row = await db.scalar(
        select(VisitItAsset).where(VisitItAsset.id == row_id, VisitItAsset.visit_id == visit_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="IT asset row not found")
    photo = await store_visit_photo(
        db, visit, current_user, file,
        it_asset_row_id=row.id,
        caption=caption or "Asset photo",
        device_id=x_device_id,
        client_photo_id=x_idempotency_key,
    )
    if row.code_photo_id is None:
        row.code_photo_id = photo.id
        await db.flush()
    return _photo_ref(photo)