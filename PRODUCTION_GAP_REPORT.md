# Production Gap Report — Branch Visit Inspection & Photo Evidence System

Prepared against `Master_Prompt.txt` §62 (inspect → report → implement in PHASE 1–12 order).
Method: parallel exploration of backend, web, mobile, infra + direct file/line evidence.

Repo inspected at: 2026-09-29 — commit baseline unknown (no git repo).

---

## 1. Stack inventory (verified)

| Area | Tech | Notes |
|---|---|---|
| Backend | FastAPI 0.115 / SQLAlchemy async / asyncpg / Alembic | `backend/app`; routes `/api/v1/*`; uvicorn (dev) / gunicorn 4w (prod compose) |
| DB | PostgreSQL 16-alpine | dev compose hardcodes `bv_user/bv_password`; prod compose reads `.env.prod` |
| Cache | Redis 7 | configured (`REDIS_URL`) but **unused** for rate-limit/sessions today |
| Object store | MinIO | `STORAGE_MODE=postgres` — photo bytes live in `photo_blobs` bytea (single source of truth) |
| Web | Next.js 14.2.15 App Router, all pages `use client`, axios + js-cookie | no middleware, no error/loading boundaries |
| Mobile | Expo SDK 57 + Expo Router, SQLite offline | `lib/offline.ts` only; APK v1.0.0 (build 7) built via EAS |
| Deploy | `docker-compose.yml` (dev/live) + `docker-compose.prod.yml` (AWS EC2) + `deploy/` scripts | prod pipeline (TLS certbot, backup.sh/restore.sh, aws.env.example) **exists** |
| CI/CD | **none** (no `.github`) | Dockerfiles + compose ready, pipeline absent |
| Monitoring | **none** | no `/metrics`, Prometheus, Grafana, structured logs, or alerts |

> Correction against earlier exploration: `docker-compose.prod.yml`, `deploy/nginx.conf` (full TLS + HSTS), `deploy/backup.sh`, `deploy/restore.sh`, `deploy/aws.env.example`, `AWS_DEPLOYMENT_GUIDE.md`, `CYBERSECURITY_CHECKLIST.md`, `docs/*` all exist. The gaps below are real; earlier "missing deploy config" was wrong.

---

## 2. Findings by severity

### CRITICAL (fix first — PHASE 1)

| # | Finding | Evidence | Fix phase |
|---|---|---|---|
| C1 | **Public register mints active, fully-trusted accounts (auto-login tokens) with no verification, no approval, no rate limit.** Any caller can POST `/auth/register`, pick role HR/REGIONAL_ADMIN/BRANCH_MANAGER/AUDITOR, choose any org scope, and receive working access+refresh tokens. | `backend/app/api/auth.py:166-260` | 1 |
| C2 | **Running deployment uses the known-default`JWT_SECRET`** (`change-this-to-a-random-64-char-secret`) — dev `docker-compose.yml:56-77` sets no `JWT_SECRET`/`env_file`, so `core/config.py:20` default applies **in the live LAN deployment that serves the APK and nginx port 80**. Anyone who can sign JWTs gets any user's `sub`. | `docker-compose.yml:56-77`; `core/config.py:20` | 1, 9 |
| C3 | **No rate limiting anywhere** (login, register, refresh, upload, all API). Brute force + account-spam + DoS. | `main.py` (no limiter); no `slowapi/limits` in `requirements.txt` | 1 |
| C4 | **Web auth cookies are non-httpOnly, non-secure, no SameSite** (`js-cookie`): `web/lib/auth.tsx:43-44` sets `access_token`/`refresh_token`. Refresh token valid 7 days. XSS → full session theft. | `web/lib/auth.tsx:43-44`; `web/next.config.js` has no `headers()` | 1 |
| C5 | **CORS allows every origin with credentials**: `allow_origin_regex=r"^https?://.*"` + `allow_credentials=True` + `allow_methods/allow_headers=["*"]`. Any website can make credentialed, readable requests to the API from a browser. | `backend/app/main.py:79-86` | 1 |

### HIGH

| # | Finding | Evidence | Fix phase |
|---|---|---|---|
| H1 | **Refresh-token rotation lacks reuse detection.** A replayed revoked token returns 401 but attackers' sessions stay alive; no "revoke all on reuse" policy. | `backend/app/api/auth.py:72-105` | 1 |
| H2 | **`change-password` does not revoke existing refresh tokens**, so a changed password leaves all old sessions/APKs valid. | `auth.py:121-130` | 1 |
| H3 | **JWT has no `iss`/`aud` and no per-device binding**; `User.device_id` column exists but is never used by auth. | `core/security.py:26-39`; `models/user.py:78` | 1 |
| H4 | **Password policy = length only** (min 8); register/change-password accept `password`/`password`-style weak values; `register` email check is `"@" in email` (no `EmailStr`). | `schemas/auth.py:19-31,67-75`; `auth.py:179` | 1 |
| H5 | **Backend boots with defaults when `ENVIRONMENT` isn't `production`**: known admin (`admin@company.com`/`change-this-password`), `DOCS_ENABLED=True` → `/docs` + `/openapi.json` reachable on the LAN through nginx. | `docker-compose.yml`; `core/config.py:41-44`; `main.py:25` | 1, 9 |
| H6 | **Photo EXIF/GPS is not stripped** — only `ImageOps.exif_transpose` (reorient) is applied before Pillow re-encode; GPS + EXIF private metadata may persist in evidence bytes. No explicit sanitize step. | `api/photos.py:90`, `:177` | 3 |
| H7 | **No photo content sniffing / decompression-bomb guard** beyond `MAX_PHOTO_SIZE_MB=10` (byte length only). Pillow decoded into memory; polyglot/zip-bomb JPEG risk. | `api/photos.py` (size via config `core/config.py:49`), no pixel-dims cap checked | 3 |
| H8 | **Evidence chain lacks tamper signal**: `sha256` is computed for minio/local `put_object` only (`utils/storage.py:136`); postgres mode stores raw bytes with no hash/verification; no "verified-original" flag. | `utils/storage.py:92-113` vs `:132-136` | 3 |
| H9 | **OCR + image compression run inline in the upload request path** (`asyncio.create_task(anyio.to_thread.run_sync(...))` in `assets.py:102`, `photos.py:177`). No queue, no retry, no worker, no manual-reprocess story. Slow discs saturate the threadpool. | `api/assets.py:102-163`, `api/photos.py:177-223` | 5 |
| H10 | **Mobile offline mode is photo-only practicality; §61 Test 3 would FAIL.** `lib/offline.ts` has 4 tables, no `sync_status`/`retry_count`/`last_error`, no idempotency key, no `device_id`, no dedupe server-side, no Pending Sync / Notifications experience; app auto-rotates base URL but queue push is manual. | `mobile/lib/offline.ts:22-99` (grep-verified 4 tables) | 4 |
| H11 | **Audit IPs are wrong behind nginx**: `client_ip()` reads `request.client.host` (docker-network IP) and ignores `X-Forwarded-For` that nginx sets; audit failures swallowed by `except Exception: pass`. | `utils/audit.py:11-14,51` | 6 |
| H12 | **Lifespan does `Base.metadata.create_all`** alongside Alembic (`main.py:58`, and `seed.py:16`) — dev + prod both risk schema drift vs. migrations. | `main.py:56-59`; `backend/seed.py:14-17` | 2 |

### MEDIUM

| # | Finding | Evidence | Fix phase |
|---|---|---|---|
| M1 | `Seed.py` runs inside prod compose startup; `SEED_DEMO` defaults to true and is **not set false** in `docker-compose.prod.yml` → demo data may seed production unless `.env.prod` sets it. | `backend/seed.py:18`; `docker-compose.prod.yml:69-93` | 9 |
| M2 | Tokens ride in URL query (`get_current_user_query`, deps.py:100-135) for `<img>/<Image>` photo loads — tokens leak to access-logs, referrers, history. | `api/deps.py:100-135` | 1, 3 |
| M3 | `DOCS_ENABLED` default `True`; dev compose doesn't set `ENVIRONMENT=production` so backend's own HSTS/CSP headers never fire in the live LAN deployment. | `core/config.py:41`; `main.py:25-33` | 9 |
| M4 | `443:443` published in dev compose but `infrastructure/nginx/nginx.conf` only `listen 80` → dead mapping; TLS only exists in prod (`deploy/nginx.conf`). | `docker-compose.yml:98`; `infrastructure/nginx/nginx.conf:16-63` | 9 |
| M5 | MinIO dependency is required-healthy even though `STORAGE_MODE=postgres`; MinIO service remains a single point of failure in dev compose. | `docker-compose.yml:30-46,68-77` | 9 |
| M6 | No structured/JSON logs, no request-id header correlation, no `/metrics`. | `main.py`, `requirements.txt` | 7 |
| M7 | Backup + restore shell scripts exist but are not scheduled (no cron/systemd), not exercised in CI, and offsite target is only documented, not wired. | `deploy/backup.sh`, `deploy/restore.sh` | 8 |
| M8 | No `.github/workflows`, no build/test/lint gate, no artifact push to registry. `REGISTRY=` env exists in prod compose but nothing builds/pushes images. | `docker-compose.prod.yml:64,99` | 10 |
| M9 | Web has zero loading/error/not-found boundaries; every page fully client-side; token lifetime entirely in browser JS. | `web/app` (17 files; no `loading.tsx`/`error.tsx`) | 1, 11 |
| M10 | Password change + `must_change_password` absent — no forced first-login change path for admins/mobile. | `models/user.py:56-84` (no field) | 1 |
| M11 | Content-Security-Policy is not emitted for the **web** app (only backend when ENVIRONMENT=production, and prod nginx strips none for `/` web). | `web/next.config.js:2-8` | 1 |
| M12 | No load testing harness or documented capacity numbers. | — | 12 |

### LOW (logged, many fold into phases)

- Auto-generated `__pycache__`/`.next`/`node_modules` in tree; no `.gitignore` hygiene (no git repo yet).
- `Dockerfile` CMD uses `--reload` uvicorn (dev-only; prod compose overrides with gunicorn).
- `docker-compose.yml` hardcodes all creds in plaintext (rotate + `env_file`).
- No version pinning for base images (`minio/minio:latest`).
- `CORS_ORIGINS` in dev compose omits the LAN origin used by the mobile team.

---

## 3. Phase plan (mirrors Master_Prompt §62)

| Phase | Scope | Pre-release definition of done |
|---|---|---|
| **1** | Security/auth/authz: rate limiting (Redis), CORS lock-down, JWT iss/aud, refresh rotation + reuse detection, change-password revokes sessions, password policy, `must_change_password`, register hardening (email val + rate limit), secret enforcement, web cookie flags + CSP/security headers | backend 13 tests + new tests green; no default secret in prod; CORS explicit |
| **2** | DB integrity: migrate away from `create_all`, add missing indexes (refresh token purge job, user scope), constraints, seed hygiene | Alembic-only bootstrap proves clean-db upgrade |
| **3** | Object storage + photo evidence: sanitize image bytes (strip EXIF), pixel-dim + decompression guard, sha256 chain-of-custody + verify endpoint, tamper-flag; signed-URL hardening (drop `?token=`) | API test: upload strips EXIF; hash verified; no token in URLs |
| **4** | Mobile offline + sync (online-merge): `sync_status`/`retry_count`/`last_error` model, `device_id` + idempotency keys, dedupe endpoints, background auto-sync, Pending Sync + Notifications tabs; **§61 Test 3 passes** | EAS test build; offline→online reconciliation verified |
| **5** | Background worker + OCR: queue upload-OCR task (Redis), worker container, retry + DLQ, manual reprocess endpoint; keep request response fast | Upload without waiting; OCR completes async; worker in compose |
| **6** | Audit logging: fix `client_ip` via X-Forwarded-For, structured details, retention/purge, admin export; wire existing web audit-logs page | Audit shows real client IPs; purge job |
| **7** | Monitoring/metrics: `/metrics` (Prometheus), request-id middleware, structured access logs, Grafana dashboard reference, alert rules | `curl /metrics` returns counters; request-id round-trip |
| **8** | Backups: cron/systemd wrapper + S3 offsite for pg_dump, verify backup.sh restore path in prod compose; document RPO/RTO | Restore drill documented + scripted |
| **9** | Docker prod config: TLS for LAN nginx, gate docs by ENVIRONMENT, `SEED_DEMO=false`, pin images, make MinIO optional in postgres mode, `.env`s committed | `docker compose -f docker-compose.prod.yml config` validates; LAN https works |
| **10** | CI/CD: GitHub Actions build/test/lint for backend+web+mobile, image push, staging deploy job | Pipeline green; images pushed to REGISTRY |
| **11** | Mobile production build: hardening for store/enterprise (HTTPS-only in prod build, HTTP fallback only in debug), store metadata, versioned release | New EAS AAB/APK build; prod build refuses cleartext |
| **12** | Acceptance + load: §61 20-test suite run from report; load test (locust/JMeter) on API + upload; soak check | All 20 pass; P95 latency + throughput documented |

---

## 4. §61 acceptance test status (mobile-critical)

| Test | Status today | Question |
|---|---|---|
| Test 1 (open visit) | ~OK online | legacy flow |
| Test 2 (assets) | ~OK online (photo+asset) | legacy flow |
| **Test 3 (complete visit offline)** | **FAIL** (not offline-capable end-to-end) | offline queue + sync phase 4 |
| Remaining 17 | unproven in current build | re-verify each after phases |

---

## 6. Implementation status (updated as phases land)

| Phase | Status | Delivered & verified |
|---|---|---|
| **1 — Security/auth** | ✅ DONE | Rate limiting (Redis + memory fallback) on login/register/refresh/API; CORS locked to explicit origins (regex removed, live-verified evil-origin rejection); JWT `iss`/`aud` claims + strict validation; refresh rotation with **reuse detection** (replay kills all sessions — live-verified); `change-password` now enforces policy + revokes all refresh tokens; `must_change_password` gate + pass-through dependency; register hardened (email regex + password policy: min 8, letter+digit); `last_login_at`; audit `client_ip` honours X-Forwarded-For; **JWT_SECRET rotated** in dev compose (replaces deployed default); config refuses default secrets when `ENVIRONMENT=production` and auto-disables `/docs`; web cookies now `Secure`+`SameSite=Strict` and `next.config.js` serves CSP/HSTS/nosniff/deny-frame/referrer/permissions headers (live on :3000). |
| **2 — DB integrity** | ✅ DONE | `create_all` removed from prod path (gated by `AUTO_CREATE_TABLES`, off when ENVIRONMENT=production, Alembic owns schema); integrity indexes added via migration & applied: refresh_tokens(user_id,revoked), audit_logs(created_at), notifications(user_id,is_read). Alembic heads clean. |
| **3 — Storage/photo evidence** | ✅ DONE | EXIF/GPS stripped from stored evidence bytes (explicit `exif=""` + `info.pop`), decompression-bomb + dimension guard (`MAX_IMAGE_PIXELS`/`MAX_IMAGE_DIMENSION`, pre-decode probe, Pillow `MAX_IMAGE_PIXELS`); new `GET /photos/{id}/checksum` re-computes SHA-256 of bytes-at-rest vs upload-time hash (tamper evidence, scope-checked). API test proves camera-model + GPS tags are gone from served bytes. |
| **4 — Mobile offline+sync** | ⏳ core done | Backend idempotency live: photos carry `device_id`+`client_photo_id` (unique; retry with same `X-Idempotency-Key` returns existing evidence — verified 21/21 incl. new test), `POST /visits` create-or-replay via `client_idempotency` table (test `test_visit_create_idempotent`), all three evidence upload routes accept the headers. Mobile `lib/offline.ts`: queue now tracks `sync_status`/`retry_count`/`last_error`, stable per-install `device_id`, idempotent photo/visit headers, exponential backoff, visit-created-offline path (404 → create → child remap), new **Pending Sync screen** (`app/(app)/pending-sync.tsx`) with per-table status + last errors + Sync Now; Home sync card routes there. Mobile `tsc --noEmit` clean. **EAS Android APK build (profile production, versionCode 8) running in background** — device test of §61 Test 3 is the remaining gate on PHASE 4. |
| **5 — Worker/OCR** | ⏳ | OCR/compress off the request path → Redis queue + worker container, retry/DLQ, reprocess endpoint. |
| **6 — Audit** | ⏳ | Retention purge job + admin export (IP-fix already done in Ph1). |
| **7 — Monitoring** | ✅ DONE | Dependency-free `/metrics` (Prometheus text: request counts by method+endpoint-label, status counts, latency sum/count, uptime) + `X-Request-Id` echo/generation on every response — live-verified on :8010, tested (`test_metrics_and_request_id`; 22/22 suite). |
| **Web e2e (same-origin proxy)** | ✅ DONE | **Root cause of web sign-in 404 fixed**: `docker-compose.yml` bakes `NEXT_PUBLIC_API_URL=/api/v1` (relative) but Next had no route → browser hit `localhost:3000/api/v1/auth/login` → Next 404. Added `rewrites()` in `web/next.config.js` proxying `/api/v1/:path* (browser) → http://backend:8000/api/v1/:path* (container)`; also `/static/:path* → http://backend:8000/static/:path*` for reference samples. Zero CORS/port friction from any hostname (`localhost:3000`, LAN, tunnel); CSP `connect-src` trimmed to `'self'` since all traffic is same-origin. `web/lib/api.ts` default API_URL → `/api/v1`; `getMediaUrl` handles relative base + raw `/api/v1` paths (no double-prefix); `getErrorMessage` now distinguishes network-level failures ("Cannot reach the backend server at …"), HTML/SPA 404 pages ("API returned an unexpected page"), and 401 (`{detail:"Invalid credentials"}`). `web/Dockerfile` ARG default aligned to `/api/v1`. Rebuilt + recreated; live-verified through the proxy: wrong password → clean **401 JSON** (not a 404 page), valid `admin@company.com` → **200 token pair**, `/users/me` + `/visits` → **200** with central-Postgres data incl. mobile-created visits (Ahmedabad IT Asset Visit, `photo_count:2`). |
| **Samples / progress / RBAC scoping** | ✅ DONE | Three live defects fixed together (all verified, 22/22): **(a) Reference samples 404** — clients build `/static/samples/<file>` (mobile `sampleUrl()`, web editor) but the mount served `/static/<file>`; now both prefixes resolve (`main.py` registers the specific `/static/samples` mount first). Verified `:8010` and `:3000`. **(b) Checklist progress stuck at 0/65** — `total_items`/`completed_items` counted *every* template row while a role only answers its own `role_tags` subset, so a 65-item shared template could never complete for HR. New `_progress_counts()`/`_item_visible()` count only the caller's answerable items across `/visits/my`, `/visits`, and `_to_details`; verified HR `1/19` (19 = 7 untagged + 12 HR-tagged) vs super admin `1/65`. **(c) HR saw the Super Admin view** — `can_access_branch`/`branch_scope_filter` treated HR as global scope, ignoring the account's own branch mapping. Introduced `GLOBAL_SCOPE_ROLES = (ADMIN, HOD, AUDITOR)`; HR is now scoped like any other mapped user (and unmapped users fall through to an impossible match). Also applied the scope to four dashboard queries that ignored it (status counts, failed categories, open/overdue actions) — those leaked global numbers to every scoped user. Verified: branch-mapped HR sees only its own branch (Bhimavaram) + zeroed dashboard cards, super admin still sees all ~500 branches. |
| **8 — Backups** | ⏳ | Schedule + S3 offsite, restore drill. |
| **9 — Docker prod** | ⏳ | LAN TLS, `SEED_DEMO=false`, pins, MinIO optionality. |
| **10 — CI/CD** | ⏳ | GitHub Actions pipeline. |
| **11 — Mobile prod build** | ⏳ | HTTPS-only prod profile, EAS rebuild. |
| **12 — Acceptance/load** | ⏳ | 20-test §61 suite + load baseline. |

Test suite: **22/22 passing** (backend/tests/test_api.py, in-container, Postgres).

---

## 7. Quick reference for continuation

- Backend run/test: `docker compose cp backend/tests/test_api.py backend:/app/tests/test_api.py` then
  `docker compose exec -T --env TEST_DATABASE_URL="postgresql+asyncpg://bv_user:bv_password@postgres:5432/bv_test" --env RATE_LIMIT_ENABLED=false backend python -m pytest tests -q`
  (Note: `RATE_LIMIT_ENABLED=false` is required — the shared Redis + fixed windows otherwise trip the suite with 429s.)
- Migration apply: `docker compose exec -T backend alembic upgrade head` (alembic/ is bind-mounted).
- Restart after changes: `docker compose restart backend`; web: `docker compose build web; docker compose up -d --force-recreate web`.
- Web API path: web serves the API **same-origin** — browser always calls `/api/v1/*`; `web/next.config.js` `rewrites()` forwards to `http://backend:8000/api/v1/*` on the compose network. So the UI works from `localhost:3000`, any LAN IP, or a tunnel without CORS/port config.
- Live API: `localhost:8010/api/v1` (LAN via nginx `:80/api/v1`). Health `localhost:8010/health`; metrics `localhost:8010/metrics` (Prometheus text).
- New PHASE 1 config knobs: `JWT_ISSUER`, `JWT_AUDIENCE`, `RATE_LIMIT_*`, `MAX_IMAGE_PIXELS`, `MAX_IMAGE_DIMENSION`, `AUTO_CREATE_TABLES` (see `.env.example`).
- Mobile typecheck: `& node "node_modules/typescript/bin/tsc" --noEmit` (run from `mobile/`; `.cmd` shims break on the space in the repo path).
- Idempotency contract (PHASE 4): evidence uploads + `POST /visits` accept `X-Device-Id` + `X-Idempotency-Key`; replay returns existing entity (photos unique on device+client id; visits mapped via `client_idempotency` table per user). Offline retries are now duplicate-safe.
- Alembic head chain: …, a1b2c3d4e5f6 → f4e5d6c7b8a9 (user security cols) → a9b8c7d6e5f4 (integrity indexes) → **c0d1e2f3a4b5 (photo idempotency + client_idempotency)**.

## 8. Guardrails (from Master_Prompt §…)

- Do **not** rewrite working modules unless a phase explicitly requires a change (rate limiter, CORS tighten, EXIF strip, queue, etc. are additive).
- Preserve API contracts for the shipped mobile APK (build 7): endpoints `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/register-options`, `/health`, `/api/v1/*`, and the photo `<token>` query-param path must keep working.
- Every backend change must keep `pytest tests` green (19 baseline) — run via docker exec with TEST_DATABASE_URL, code copied in first.