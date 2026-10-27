import json
import os
from typing import List

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    DATABASE_URL: str = "postgresql+asyncpg://bv_user:bv_password@localhost:5432/bv_inspection"
    REDIS_URL: str = "redis://localhost:6379/0"

    # Storage backend: "postgres" = image bytes in the DB (production default
    #   — single source of truth for photo evidence).
    # "auto" = MinIO if reachable, else local disk.
    # "minio" = always MinIO/S3. "local" = always local disk (zero-dependency run).
    STORAGE_MODE: str = "postgres"
    # Local disk storage root (used when MinIO is not available/mode=local).
    LOCAL_STORAGE_DIR: str = "./data/photos"

    JWT_SECRET: str = "change-this-to-a-random-64-char-secret"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Bound every token to this service so a token minted elsewhere (or for a
    # different audience on this service) can never be accepted.
    JWT_ISSUER: str = "branchvisit-system"
    JWT_AUDIENCE: str = "branchvisit-api"

    # Rate limiting (Redis-backed; per-process memory fallback when Redis is down).
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_LOGIN_PER_MINUTE: int = 5
    RATE_LIMIT_REGISTER_PER_HOUR: int = 10
    RATE_LIMIT_REFRESH_PER_MINUTE: int = 20
    RATE_LIMIT_API_PER_MINUTE: int = 3000

    # CAPTCHA ("I'm not a robot") on login — blocks automated brute-force.
    CAPTCHA_ENABLED: bool = True
    CAPTCHA_MIN_DELAY_SECONDS: float = 1.5
    CAPTCHA_TTL_SECONDS: int = 300

    # Account lockout after repeated failed logins.
    LOGIN_MAX_FAILED_ATTEMPTS: int = 3
    LOGIN_LOCKOUT_MINUTES: int = 30

    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "branch-visit-photos"
    MINIO_SECURE: bool = False
    # S3 signature region. Empty = MinIO default. For real AWS S3 set to the
    # bucket's region (e.g. "ap-south-1") — required for presigned URLs to sign
    # correctly against AWS (us-east-1 must also be set explicitly).
    MINIO_REGION: str = ""

    APP_NAME: str = "Branch Visit Inspection"
    APP_URL: str = "http://localhost:3000"
    API_URL: str = "http://localhost:8000"

    # Expose FastAPI interactive docs (/docs, /redoc, /openapi.json).
    # Disable (False) in production to reduce information disclosure.
    DOCS_ENABLED: bool = True

    SUPER_ADMIN_EMAIL: str = "admin@company.com"
    SUPER_ADMIN_PASSWORD: str = "change-this-password"

    CORS_ORIGINS: str = '["http://localhost:3000","http://localhost:3001","http://localhost:8081"]'

    GPS_ENABLED: bool = True
    MAX_PHOTO_SIZE_MB: int = 10
    PHOTO_QUALITY: int = 80
    THUMBNAIL_SIZE: int = 200
    # Decompression-bomb guard: reject images above these bounds while decoding.
    MAX_IMAGE_PIXELS: int = 40_000_000
    MAX_IMAGE_DIMENSION: int = 6000

    # ---- Concurrency budgets (anti-crash tuning) ---------------------------
    # OCR runs a deep-learning model and is the most memory-hungry operation
    # in the system. It runs on its own dedicated pool so it can never starve
    # (or be starved by) the API's shared thread limiter, and concurrency is
    # capped per worker process. Total OCR concurrency across the deployment
    # is roughly OCR_MAX_CONCURRENCY * gunicorn_workers.
    OCR_MAX_CONCURRENCY: int = 2
    # Do not block an upload waiting for an OCR slot. When every slot is busy
    # for longer than this, skip OCR and persist the photo anyway; the user
    # confirms/corrects the code manually. Prevents request pile-up.
    OCR_QUEUE_WAIT_SECONDS: float = 5.0
    # Hard ceiling on a single OCR run so one pathological image cannot pin a
    # slot and starve every later upload.
    OCR_TIMEOUT_SECONDS: float = 45.0
    # Max bytes to enqueue for async OCR. Large original photos are downscaled/
    # compressed; we keep the original for OCR but cap what goes into Redis.
    OCR_QUEUE_MAX_BYTES: int = 2 * 1024 * 1024  # 2 MB
    OCR_QUEUE_MAX_DEPTH: int = 200
    # Dedicated pool for decode/compress/thumbnail work. Must exceed
    # OCR_MAX_CONCURRENCY on small hosts only if CPU headroom allows.
    IMAGE_MAX_CONCURRENCY: int = 4

    # ---- Server-side photo compression (storage efficiency) ----------------
    # Evidence photos are recompressed before storage. "Target size" is the
    # hard goal: encoders walk quality (and then dimensions) down until the
    # bytes fit. Existing small files pass through untouched when skip-if-
    # smaller is on, so uploads that arrive already optimized keep their bits.
    PHOTO_STORAGE_MAX_DIMENSION: int = 1600
    PHOTO_STORAGE_TARGET_KB: int = 200
    PHOTO_STORAGE_MIN_QUALITY: int = 55
    PHOTO_STORAGE_SKIP_IF_SMALLER: bool = True

    # Dev convenience: create missing tables on startup. Production relies on
    # Alembic migrations only (the container runs `alembic upgrade head` first).
    AUTO_CREATE_TABLES: bool = True

    @property
    def environment(self) -> str:
        return os.getenv("ENVIRONMENT", "").lower()

    @property
    def is_production(self) -> bool:
        return self.environment in ("production", "prod")

    @model_validator(mode="after")
    def _enforce_production_safety(self):
        if self.is_production:
            if self.JWT_SECRET == "change-this-to-a-random-64-char-secret":
                raise ValueError("JWT_SECRET must be overridden in production")
            if self.SUPER_ADMIN_PASSWORD == "change-this-password":
                raise ValueError("SUPER_ADMIN_PASSWORD must be overridden in production")
            # Interactive API docs surface the whole schema — keep them internal.
            if self.DOCS_ENABLED:
                self.DOCS_ENABLED = False
            # Schema changes must flow through Alembic in production.
            if self.AUTO_CREATE_TABLES:
                self.AUTO_CREATE_TABLES = False
        return self

    @property
    def cors_origins_list(self) -> List[str]:
        return json.loads(self.CORS_ORIGINS)


settings = Settings()
