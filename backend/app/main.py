import os
import sys
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware

from core.config import settings
from core.database import engine, Base
from middleware.rate_limit import RateLimitMiddleware
from middleware.observability import ObservabilityMiddleware, render_metrics


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Baseline security headers for the web UI and API responses."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-XSS-Protection", "1; mode=block")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()")
        if os.getenv("ENVIRONMENT", "").lower() in ("production", "prod"):
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"
            )
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'",
            )
        return response

from api import (
    auth,
    users,
    roles,
    branches,
    visits,
    checklists,
    photos,
    actions,
    reviews,
    reports,
    dashboard,
    admin_reset,
    assets,
    employees,
    inspections,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience only: create missing tables when AUTO_CREATE_TABLES is on.
    # Production keeps the flag off and relies on `alembic upgrade head`, which
    # the container entrypoint runs before uvicorn starts.
    if settings.AUTO_CREATE_TABLES:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    try:
        from utils.storage import ensure_bucket
        ensure_bucket()
    except Exception:
        pass
    yield
    # Drain the dedicated OCR/image pools so in-flight photo work finishes
    # instead of being cut off mid-request on worker shutdown/reload.
    try:
        from utils.ocr_runtime import shutdown_ocr_runtime
        await shutdown_ocr_runtime()
    except Exception:
        pass
    try:
        from utils.img_runtime import shutdown_image_runtime
        await shutdown_image_runtime()
    except Exception:
        pass
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    docs_url="/api/v1/docs" if settings.DOCS_ENABLED else None,
    redoc_url="/api/v1/redoc" if settings.DOCS_ENABLED else None,
    openapi_url="/api/v1/openapi.json" if settings.DOCS_ENABLED else None,
    lifespan=lifespan,
)

app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(ObservabilityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    # Only the methods/headers the app actually uses — no wildcards.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
)

API_PREFIX = "/api/v1"

# Static reference assets (sample checklist evidence photos/PDFs) served
# directly from the backend container — the mobile app and web editors load
# these to show users *how* to capture an item's photo. No auth: these are
# curated reference files baked into the image, not sensitive customer data.
from fastapi.staticfiles import StaticFiles

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static_samples")
if os.path.isdir(STATIC_DIR):
    # Clients reference samples as /static/samples/<file> (mobile sampleUrl() and
    # the web checklist editor both build that path from the API base), while the
    # mount root is /static. Register the more specific prefix FIRST so it wins
    # over the /static catch-all mount — otherwise /static/samples/... 404s.
    app.mount("/static/samples", StaticFiles(directory=STATIC_DIR), name="static-samples")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

for api_router in (
    auth.router,
    users.router,
    roles.router,
    branches.router,
    visits.router,
    checklists.router,
    photos.router,
    actions.router,
    reviews.router,
    reports.router,
    dashboard.router,
    admin_reset.router,
    assets.router,
    employees.router,
    inspections.router,
):
    app.include_router(api_router, prefix=API_PREFIX)


@app.get("/")
@app.get("/api/v1")
@app.get("/api/v1/")
async def root():
    return {
        "app": settings.APP_NAME,
        "status": "ok",
        "version": "1.0.0",
        "docs": "/branch-visit/api/v1/docs",
        "endpoints": {
            "auth": "/branch-visit/api/v1/auth/login",
            "branches": "/branch-visit/api/v1/branches",
            "visits": "/branch-visit/api/v1/visits",
            "checklists": "/branch-visit/api/v1/checklists/templates",
            "reports": "/branch-visit/api/v1/reports",
            "photos": "/branch-visit/api/v1/photos",
        },
    }


# ---------------------------------------------------------------------------
# Super Admin monitoring website (self-contained SPA, no build step needed).
# Calls the same /api/v1 endpoints with a Bearer token stored in the session.
# ---------------------------------------------------------------------------
ADMIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "admin_static")


@app.get("/admin", include_in_schema=False)
@app.get("/admin/", include_in_schema=False)
@app.get("/admin/{rest:path}", include_in_schema=False)
async def admin_site(rest: str = ""):
    """Serve the Super Admin SPA for any /admin path (client-side routing).

    no-store: browsers kept showing a stale cached page (black/blank screen)
    after updates — this forces a fresh copy every load.
    """
    return FileResponse(
        os.path.join(ADMIN_DIR, "index.html"),
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


@app.get("/health")
@app.get("/api/v1/health")
async def health():
    """Liveness + concurrency-budget diagnostics.

    The `workers` block reports how much OCR/image capacity this process has
    left, which is the first thing to check when a load test shows photo
    uploads degrading: `workers.ocr.at_capacity == true` means every OCR slot
    is busy and new uploads are skipping OCR by design (photo still stored)
    rather than blocking requests or crashing the worker.
    """
    payload = {"status": "healthy"}
    try:
        from utils.ocr_runtime import ocr_runtime_info
        from utils.img_runtime import image_runtime_info

        payload["workers"] = {
            "ocr": ocr_runtime_info(),
            "image": image_runtime_info(),
            "pid": os.getpid(),
        }
    except Exception:
        pass
    try:
        from utils.ocr_queue import queue_depth

        # Depth of the async OCR work queue. A number that keeps climbing means
        # the worker is not keeping up (or is down) and plate reads will stay
        # null until it drains.
        payload.setdefault("workers", {})["ocr_queue_depth"] = await queue_depth()
    except Exception:
        pass
    return payload


@app.get("/metrics", include_in_schema=False, response_class=PlainTextResponse)
async def metrics():
    """Prometheus text-format metrics for scrape targets."""
    return render_metrics()