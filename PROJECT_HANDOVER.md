# Project Handover — Branch Visit Inspection System

> Purpose: a complete, self-contained briefing you can paste into another AI coding tool
> (or a new engineer) so it can work on this repo without re-discovering everything.
> Written after PHASE 1–4 + 7 landed and the web/mobile data defects were fixed.
> Source of truth for progress: `PRODUCTION_GAP_REPORT.md`. Requirements: `Master_Prompt.txt`.

---

## 1. What this project is

A field-inspection SaaS for a bank/retail chain (~500 branches).

- **Mobile (Expo/React Native)** — inspectors visit a branch, answer a role-specific
  checklist, capture mandatory photo evidence, and submit. **Must work offline.**
- **Web (Next.js)** — managers/HR/auditors monitor visits, review submissions,
  approve/reject, track corrective actions, manage the org tree and employees.
- **Backend (FastAPI)** — REST API, JWT auth, RBAC, Postgres, photo evidence storage.

Core loop: **create visit → assign inspectors → answer checklist + photos offline →
submit → review → approve/reject → corrective actions → reports.**

---

## 2. Repo layout

```
backend/    FastAPI app (app/{api,models,schemas,core,services,middleware,utils}), alembic/, tests/, seed_demo.py
web/        Next.js 14 App Router — all pages are client components (use react-query + axios)
mobile/     Expo SDK 57 / RN 0.86, expo-router, zustand, AsyncStorage offline queue
deploy/     nginx + caddy prod configs, setup.sh, restore scripts
infrastructure/  legacy nginx
docs/       architecture.md, deployment.md, specs/
Master_Prompt.txt        original 12-phase hardening requirements
PRODUCTION_GAP_REPORT.md gap analysis + per-phase delivery status  ← read this
```

DB is named **`bv_inspection`** (test DB is `bv_test`).

---

## 3. Stack (exact versions)

| Layer | Versions |
|---|---|
| Backend | FastAPI 0.115, SQLAlchemy 2.0.35 (async), asyncpg 0.29, Alembic 1.13.2, Pydantic 2.9.2, python-jose 3.3, bcrypt 5.0, Redis 5.1, MinIO 7.2, Pillow 10.4, openpyxl, pytesseract, Python 3.12 |
| Web | Next.js 14.2.15, React 18.3.1, axios, @tanstack/react-query 5, recharts, js-cookie, Tailwind 3.4 |
| Mobile | Expo SDK 57, React Native 0.86, expo-router 4, expo-camera, **expo-sqlite (offline queue)**, expo-secure-store, zustand 5 |
| Infra | Docker Compose (postgres, redis, minio, backend, web), nginx (prod TLS) |

---

## 4. Running it

```bash
docker compose up -d --build
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:8010/api/v1  (docs at `/docs`, health `/health`, metrics `/metrics`) |
| Admin console (separate SPA) | http://localhost:8010/admin |
| Super admin login | `admin@company.com` / `change-this-password` |

**Port 8010 is deliberate** — 8000 is already taken on this machine (Supabase stack).
Inside the Docker network the backend listens on **8000**; only the host mapping is 8010.

### Build / restart commands
```bash
docker compose build backend ; docker compose up -d --force-recreate backend
docker compose build web     ; docker compose up -d --force-recreate web
docker compose exec -T backend alembic upgrade head
```

### Test suite — **must stay 22/22 green**
```bash
docker compose cp backend/tests/test_api.py backend:/app/tests/test_api.py
docker compose exec -T --env TEST_DATABASE_URL="postgresql+asyncpg://bv_user:bv_password@postgres:5432/bv_test" --env RATE_LIMIT_ENABLED=false backend python -m pytest tests -q
```
Two gotchas:
1. `RATE_LIMIT_ENABLED=false` is **required** — the suite shares the live Redis and
   fixed request windows, otherwise it trips its own 429s.
2. `pytest` is **not** in `requirements.txt`. After any backend image rebuild run
   `docker compose exec -T backend pip install pytest pytest-asyncio httpx` first.

---

## 5. Environment gotchas (Windows)

- **The repo path contains spaces and commas** — PowerShell chokes on `.cmd` shims.
  Run typechecks as: `& node "node_modules/typescript/bin/tsc" --noEmit`
- `docker compose cp` is more reliable than in-container editing on this machine.
- DB name is `bv_inspection`, not `branchvisit`.
- Mobile dev build uses LAN `http://<PC-IP>:8010/api/v1` (port **8010**).

---

## 6. Architecture decisions that are easy to break

### 6.1 Web talks to the API **same-origin** (this is intentional)
`web/lib/api.ts` sets `API_URL = "/api/v1"` (relative). `web/next.config.js` has
`rewrites()` that forward, **server-side**, to the backend container:

```
/api/v1/:path*   ->  http://backend:8000/api/v1/:path*
/static/:path*   ->  http://backend:8000/static/:path*
```

So the browser always calls its own origin. **Never hardcode `localhost:8000/8010`
into web code** — it was the cause of the sign-in 404 (browser hit
`localhost:3000/api/v1/auth/login`, Next had no route, returned a 404 page).
This also makes the web app work from any hostname (localhost, LAN IP, tunnel) with
zero CORS/port config. CSP `connect-src` is `'self'` for this reason.

### 6.2 Photo storage is swappable — `STORAGE_MODE`
`backend/app/utils/storage.py`, one API surface, four backends:
`postgres` (bytes as `bytea` in `photo_blobs` — **current default**), `minio`/S3,
`local` disk, `auto` (probe MinIO, fall back to local). The API layer never knows
which is active. Bytes are always served through `GET /photos/{id}/file`.

### 6.3 Photos are **anonymised at rest**
EXIF/GPS are stripped from the stored bytes (PHASE 3), plus decompression-bomb and
dimension guards (`MAX_IMAGE_PIXELS` / `MAX_IMAGE_DIMENSION`).
`GET /photos/{id}/checksum` re-computes SHA-256 of the bytes at rest to prove
tamper-evidence. **Do not re-enable EXIF retention.**

### 6.4 Auth tokens in the browser live in **js-cookie, not httpOnly**
This is a known accepted gap (listed as C4 in the gap report). The mitigation today is
`Secure` + `SameSite=Strict` + strict CSP. A full fix means an httpOnly cookie +
token-rotation endpoint — not done yet.

---

## 7. Domain model

### Org tree
`regions → areas → branches`. Users map to any level via `region_id` / `area_id` /
`branch_id` on the `users` row. **Branch→Area→Region assignment is the core of data
scoping** (see §8.2).

### Roles (8)
`SUPER_ADMIN, ADMIN, HOD, REGIONAL_ADMIN, AREA_MANAGER, BRANCH_MANAGER, HR, AUDITOR`
Permissions are a per-role permission list in `core/permissions.py`; endpoints guard
with `require_permission(Permission.X)`.

### Checklist templates — the subtlest part of the system
`checklist_templates → checklist_sections → checklist_items`. Each item carries:

- `role_tags: ["ADMIN","HR","OPS","OTHERS"]` — **empty list = visible to everyone.**
  A 65-item template is *shared* by all roles; each role answers only its own subset.
- `photo_allowed`, `photo_required_on`, `remark_required_on`, `action_required_on`,
  `responsible_required_on`, `target_date_required_on` — drive per-status validation.
- `sample_refs` — reference evidence PDFs served from `/static/samples/<file>`.

At visit start, template items are **hydrated** into `visit_checklist_items` rows
(`_hydrate_visit_items`, self-healing on GET checklist).

Two role maps exist and must agree: `ROLE_TO_CHECKLIST_TAG` (role → tag) and
`GLOBAL_SCOPE_ROLES` (roles that see all branches). **HR is deliberately NOT in
`GLOBAL_SCOPE_ROLES`** — an HR account is branch-mapped like any other scoped user.

### Visit state machine — `services/visit_service.py`
```
DRAFT → ASSIGNED/SCHEDULED/IN_PROGRESS/SUBMITTED/CANCELLED
IN_PROGRESS → DRAFT, SUBMITTED
SUBMITTED → UNDER_REVIEW, DRAFT
UNDER_REVIEW → APPROVED, REJECTED, REWORK_REQUIRED
REJECTED → REWORK_REQUIRED, UNDER_REVIEW, IN_PROGRESS, SUBMITTED, RESUBMITTED
REWORK_REQUIRED → IN_PROGRESS, RESUBMITTED, SUBMITTED
APPROVED → CLOSED
CLOSED / CANCELLED → terminal
```
Note `DRAFT → SUBMITTED` is deliberately allowed (mobile submits without a start step).

### Compliance score
On submit: `compliance_percentage = OK / (OK + NOT_OK) * 100` (NA excluded).

---

## 8. Two bug classes that were just fixed — read before touching this code

### 8.1 Progress denominators must be role-filtered
`/visits/my`, `/visits` and `_to_details` used to count **all 65** `visit_checklist_items`
rows, so an HR user who answered every item they could see still showed a progress
bar stuck at a fraction of 65 — it could never reach 100%.
Now `_progress_counts(db, vids, user_tags)` joins `checklist_items` and counts only
items the calling user can answer (`_item_visible`). Verified: HR `1/19`, super admin `1/65`.
**Any new progress/count surface must use `_progress_counts`, not a raw count.**

### 8.2 Branch scoping must be applied to *every* query, not just some
`branch_scope_filter(user)` returns a SQLAlchemy filter (or `None` = all) and
`can_access_branch(user, branch)` is the object-level check. The dashboard had **four**
queries that silently ignored the scope (status counts, failed categories, open actions,
overdue actions) — every scoped user saw global numbers. All scoping is now applied.
**When adding a list/report endpoint: apply the scope, and verify with a scoped user.**

---

## 9. Offline / idempotency contract (PHASE 4)

Mobile queue lives in `mobile/lib/offline.ts` — a local **expo-sqlite** database named
`branch-visit-offline.db` (not AsyncStorage), with a `meta` row holding a stable
per-install `device_id` (`getDeviceId()`).

Queue tables: `pending_visits`, `pending_checklist_items`, `pending_actions`,
`pending_photos`, `meta`. Every queue table carries
`sync_status` (`pending`/`synced`/`failed`), `retry_count`, `last_error`.

`syncAll()` drains the queue. Retries use exponential backoff (`backoffMs()`), and a
failure marks the row `failed` with the reason rather than dropping it. Offline-created
visits are re-mapped from their client id to the server id (PATCH 404 → idempotent
POST → remap children), so a failed sync never duplicates a visit.

### Idempotency headers
| Header | Sent as | On |
|---|---|---|
| `X-Device-Id` | stable per-install UUID | offline visit/photo writes |
| `X-Idempotency-Key` | the local queue row id (deterministic, replay-safe) | `POST /visits`, `POST /visits/{id}/start`, `PATCH /visits/{id}`, photo upload |

The **server** accepts both headers more broadly than the client currently sends them:
`POST /visits` (`visits.py`), both asset-photo endpoints (`assets.py`), and photo
upload (`photos.py`). Replay returns the **existing** entity, never a duplicate —
backed by `photos.device_id + photos.client_photo_id` (unique) and the
`client_idempotency` table (keyed by `key + user_id + method + path`).

**Do not remove these headers or the unique constraints** — they are what makes offline
retry safe. Pending-sync UI: `mobile/app/(app)/pending-sync.tsx`.

---

## 10. What has landed (from `PRODUCTION_GAP_REPORT.md`)

| Phase | Status |
|---|---|
| 1 Security/auth | ✅ rate limits (Redis), CORS lock-down, JWT iss/aud, refresh rotation + reuse detection, password policy, `must_change_password`, register hardening, cookie flags, CSP |
| 2 DB integrity | ✅ `AUTO_CREATE_TABLES` gate (off in prod), integrity indexes |
| 3 Photo evidence | ✅ EXIF/GPS strip, bomb/dimension guard, `/photos/{id}/checksum` |
| 4 Mobile offline+sync | ✅ backend idempotency + mobile queue + Pending Sync screen (APK v8 built; on-device test is the last gate) |
| 5 Worker/OCR | ⏳ OCR/compress still on the request path — needs Redis queue + worker |
| 6 Audit | ⏳ retention purge + admin export |
| 7 Monitoring | ✅ `/metrics` (Prometheus text) + `X-Request-Id` on every response |
| 8 Backups | ⏳ schedule + offsite + restore drill |
| 9 Docker prod | ⏳ LAN TLS, `SEED_DEMO=false`, image pins |
| 10 CI/CD | ⏳ GitHub Actions |
| 11 Mobile prod build | ⏳ HTTPS-only profile |
| 12 Acceptance/load | ⏳ §61 20-test suite + load baseline |
| *(ad hoc)* Web e2e | ✅ same-origin `/api/v1` proxy, real error messages, samples, scoping, progress |

Alembic head: **`c0d1e2f3a4b5`** (photo idempotency + `client_idempotency`).

---

## 11. Guardrails for anyone (AI or human) changing this repo

1. **Keep the API contract stable.** A production APK is installed in the field
   (build 8). Endpoints and the photo `?token=` query-param auth path must keep working.
2. **22/22 tests must pass** after any backend change (see §4 for the exact command).
3. **Don't rewrite working modules.** Most phases were additive on purpose.
4. **New list/report endpoints must apply `branch_scope_filter`.** Verify with a
   branch-scoped user, not the super admin.
5. **New progress/count surfaces must use `_progress_counts`** (role-filtered).
6. **Don't hardcode ports/hosts in web code** — use the relative `/api/v1` + rewrites.
7. **Don't re-enable EXIF/GPS** on stored evidence, and keep the photo checksum endpoint working.
8. **Migrations**: never edit an applied migration; add a new one and re-apply.

---

## 12. Common tasks → where to look

| Task | File |
|---|---|
| Add/change a role or permission | `backend/app/core/permissions.py` |
| Change who sees which branches | `backend/app/api/deps.py` (`GLOBAL_SCOPE_ROLES`, `branch_scope_filter`) |
| Change checklist item validation | `backend/app/api/visits.py::update_checklist_item` |
| Change progress counting | `backend/app/api/visits.py::_progress_counts` |
| Change visit state machine | `backend/app/services/visit_service.py` |
| Change photo storage backend | `backend/app/utils/storage.py` |
| Change web↔API routing | `web/next.config.js` (rewrites) + `web/lib/api.ts` (`API_URL`) |
| Change offline queue / sync | `mobile/lib/offline.ts` |
| Change mobile API base URL | `mobile/lib/api.ts` + EAS build profile |

---

## 13. Known open items worth flagging to the next tool

- Several seeded accounts (`bm@test.local`, `ops@test.local`, `ra@test.local`,
  `hr@test.local`) have **no branch/area/region mapping** — under the corrected
  scoping they will see zero data until mapped via the web **Organization** page.
- OCR (`pytesseract`) runs synchronously inside photo upload → slow requests (PHASE 5).
- Web has no `loading.tsx` / `error.tsx` boundaries; every page is client-rendered.
- Audit logs have no retention/purge job and no admin export yet.
- No CI pipeline; tests are run manually via docker.
