"""Photo storage with interchangeable backends:

- "s3"      : AWS S3 directly via boto3 (production default for branch-visit)
- "postgres": image bytes stored as bytea directly in PostgreSQL
- "minio"   : S3-compatible MinIO
- "local"   : plain local disk folder (zero external services)

STORAGE_MODE env picks the backend:
  s3       -> AWS S3 (bucket: svhrms, key prefix: branch-visit/)
  minio    -> force MinIO/S3
  local    -> force local disk
  postgres -> force PostgreSQL bytea storage
  auto     -> try S3/MinIO first; fallback to local
"""
import hashlib
import io
import logging
import os
import shutil
import threading
import uuid
from datetime import timedelta
from pathlib import Path
from typing import BinaryIO

from core.config import settings

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Environment & Backend selection
# --------------------------------------------------------------------------
USE_S3 = os.getenv("USE_S3_STORAGE", "").lower() in ("1", "true", "yes")
S3_BUCKET = os.getenv("AWS_S3_BUCKET", settings.MINIO_BUCKET or "svhrms").strip()
AWS_REGION = os.getenv("AWS_REGION", settings.MINIO_REGION or "ap-south-1")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", settings.MINIO_ACCESS_KEY or "").strip() or None
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", settings.MINIO_SECRET_KEY or "").strip() or None
S3_KEY_PREFIX = os.getenv("S3_KEY_PREFIX", "branch-visit").strip("/")

_backend: str | None = None
_boto3_client = None
_boto3_lock = threading.Lock()


def _build_boto3():
    global _boto3_client
    if _boto3_client is not None:
        return _boto3_client
    with _boto3_lock:
        if _boto3_client is not None:
            return _boto3_client
        try:
            import boto3
            from botocore.config import Config

            kwargs = {
                "region_name": AWS_REGION,
                "config": Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
            }
            if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
                kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
                kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY
            _boto3_client = boto3.client("s3", **kwargs)
            logger.info("Storage S3 client initialized for bucket '%s' region '%s'", S3_BUCKET, AWS_REGION)
        except Exception as exc:
            logger.error("Failed to initialize boto3 S3 client: %s", exc)
            _boto3_client = None
    return _boto3_client


def _minio_available() -> bool:
    """One cheap probe: can we reach MinIO/S3 right now?"""
    if USE_S3 or AWS_ACCESS_KEY_ID:
        return True
    try:
        from minio import Minio

        client = _build_minio()
        bucket = settings.MINIO_BUCKET
        try:
            if not client.bucket_exists(bucket):
                client.make_bucket(bucket)
        except Exception:
            return False
        return True
    except Exception:
        return False


def _build_minio():
    from minio import Minio

    kwargs = {
        "access_key": settings.MINIO_ACCESS_KEY,
        "secret_key": settings.MINIO_SECRET_KEY,
        "secure": settings.MINIO_SECURE,
    }
    if settings.MINIO_REGION:
        kwargs["region"] = settings.MINIO_REGION
    return Minio(settings.MINIO_ENDPOINT, **kwargs)


def _local_root() -> Path:
    root = Path(settings.LOCAL_STORAGE_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def backend_name() -> str:
    """Resolve (and cache) the active storage backend."""
    global _backend
    if _backend is None:
        mode = (settings.STORAGE_MODE or "auto").lower()
        if mode in ("s3", "aws") or USE_S3:
            _backend = "s3"
        elif mode == "postgres":
            _backend = "postgres"
        elif mode == "local":
            _backend = "local"
        elif mode == "minio":
            _backend = "minio"
        else:  # auto
            _backend = "s3" if (USE_S3 or AWS_ACCESS_KEY_ID) else ("minio" if _minio_available() else "local")
    return _backend


def is_postgres_mode() -> bool:
    """True when photo bytes are stored in the PostgreSQL photo_blobs table."""
    return backend_name() == "postgres"


async def store_photo_blob(db, photo_id, data: bytes, content_type: str, thumbnail: bytes | None) -> None:
    """Write photo bytes into PostgreSQL (STREAM-safe: single INSERT)."""
    from models.photo import PhotoBlob

    db.add(
        PhotoBlob(
            photo_id=photo_id,
            data=data,
            thumbnail=thumbnail,
            mime_type=content_type,
        )
    )


async def load_photo_blob(db, photo_id) -> "tuple[bytes, bytes, str] | None":
    """Return (data, thumbnail, mime_type) from PostgreSQL, or None."""
    from models.photo import PhotoBlob

    row = await db.get(PhotoBlob, photo_id)
    if row is None:
        return None
    return row.data, (row.thumbnail or b""), (row.mime_type or "image/jpeg")


def ensure_bucket() -> None:
    """Create the bucket / storage root if missing (safe to call often)."""
    if backend_name() == "local":
        _local_root()
        return
    if backend_name() == "s3":
        return  # S3 bucket exists in AWS
    try:
        client = _build_minio()
        if not client.bucket_exists(settings.MINIO_BUCKET):
            client.make_bucket(settings.MINIO_BUCKET)
    except Exception:
        pass


# --------------------------------------------------------------------------
# Core operations — same signature for all backends
# --------------------------------------------------------------------------
def put_object(data: bytes, content_type: str, prefix: str) -> tuple[str, str]:
    """Store bytes; returns (object_key, sha256_hash)."""
    ext = "png" if "png" in (content_type or "") else "jpg"
    full_prefix = f"{S3_KEY_PREFIX}/{prefix.lstrip('/')}" if S3_KEY_PREFIX and not prefix.startswith(S3_KEY_PREFIX) else prefix
    key = f"{full_prefix}/{uuid.uuid4().hex}.{ext}"
    checksum = hashlib.sha256(data).hexdigest()

    bname = backend_name()
    if bname == "s3":
        client = _build_boto3()
        client.put_object(Bucket=S3_BUCKET, Key=key, Body=data, ContentType=content_type)
        return key, checksum

    if bname == "local":
        path = _local_root() / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key, checksum

    client = _build_minio()
    client.put_object(
        settings.MINIO_BUCKET, key, io.BytesIO(data), length=len(data), content_type=content_type
    )
    return key, checksum


def get_object_bytes(key: str) -> tuple[bytes, str] | None:
    """Return (bytes, content_type) or None if not found."""
    bname = backend_name()
    if bname == "s3":
        try:
            client = _build_boto3()
            resp = client.get_object(Bucket=S3_BUCKET, Key=key)
            data = resp["Body"].read()
            content_type = resp.get("ContentType", "image/jpeg")
            return data, content_type
        except Exception as e:
            logger.warning("S3 get_object failed key=%s: %s", key, e)
            return None

    if bname == "local":
        path = _local_root() / key
        if not path.is_file():
            return None
        ctype = "image/png" if path.suffix == ".png" else "image/jpeg"
        return path.read_bytes(), ctype

    response = None
    try:
        client = _build_minio()
        response = client.get_object(settings.MINIO_BUCKET, key)
        data = response.read()
        content_type = response.headers.get("Content-Type", "image/jpeg")
        return data, content_type
    except Exception:
        return None
    finally:
        if response is not None:
            response.close()
            response.release_conn()


def delete_object(key: str) -> None:
    bname = backend_name()
    if bname == "s3":
        try:
            _build_boto3().delete_object(Bucket=S3_BUCKET, Key=key)
        except Exception:
            pass
        return

    if bname == "local":
        path = _local_root() / key
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
        return
    try:
        _build_minio().remove_object(settings.MINIO_BUCKET, key)
    except Exception:
        pass


def get_presigned_url(key: str, expires_seconds: int = 3600) -> str | None:
    """Presigned URL for direct client reads."""
    bname = backend_name()
    if bname == "s3":
        try:
            client = _build_boto3()
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": key},
                ExpiresIn=expires_seconds,
            )
        except Exception:
            return None

    if bname == "local":
        return None
    try:
        return _build_minio().presigned_get_object(
            settings.MINIO_BUCKET, key, expires=timedelta(seconds=expires_seconds)
        )
    except Exception:
        return None


def get_thumbnail_key(original_key: str) -> str:
    parts = original_key.rsplit("/", 1)
    return f"{parts[0]}/thumb_{uuid.uuid4().hex}.jpg"


def wipe_all_objects() -> int:
    """Delete every stored object (used by the Vanish-all-data reset). Returns count."""
    n = 0
    if is_postgres_mode():
        return 0
    bname = backend_name()
    if bname == "s3":
        try:
            client = _build_boto3()
            paginator = client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=f"{S3_KEY_PREFIX}/"):
                for obj in page.get("Contents", []):
                    client.delete_object(Bucket=S3_BUCKET, Key=obj["Key"])
                    n += 1
            return n
        except Exception:
            return n
    if bname == "local":
        root = _local_root()
        for p in root.rglob("*"):
            if p.is_file():
                n += 1
        if root.exists():
            shutil.rmtree(root, ignore_errors=True)
            root.mkdir(parents=True, exist_ok=True)
        return n
    client = _build_minio()
    try:
        objects = client.list_objects(settings.MINIO_BUCKET, recursive=True)
        names = [o.object_name for o in objects]
        for name in names:
            try:
                client.remove_object(settings.MINIO_BUCKET, name)
                n += 1
            except Exception:
                pass
        return n
    except Exception:
        return n
