# Progress Log

## Session 2026-09-25
- Explored both codebases (app + ActAI-Recruitment reference) via two subagents. Full maps in findings.md.
- Created task_plan.md / findings.md / progress.md.

## Phase 1 — mobile upload fix (COMPLETE)
- Root cause confirmed: Expo SDK 57 WinterCG fetch throws "Unsupported FormDataPart implementation" for RN `{uri,name,type}` FormData parts.
- Fixed `mobile/app/(app)/camera.tsx`: `uploadPhoto` and `publishScan` now use the axios `api` instance (XHR adapter) like `lib/offline.ts` (proven path); auth + refresh handled by interceptor.
- Removed unused imports (SecureStore, API_URL); timeout detection uses `ECONNABORTED`; errors via `getErrorMessage`.
- `tsc --noEmit` clean.

## Phase 2 — PostgreSQL bytea photo storage (COMPLETE)
- New `PhotoBlob` model (`photo_blobs`): photo_id PK FK→photos.id (ON DELETE CASCADE), data bytea, thumbnail bytea, mime_type.
- `STABLE_STORAGE_MODE` / `STORAGE_MODE=postgres` added: config default changed to `postgres`; `backend/.env` (SQLite local run) still pins `local`; dev compose switched to `postgres`; MinIO vars kept for legacy read-back.
- storage.py: `is_postgres_mode()`, `store_photo_blob()`, `load_photo_blob()`; `wipe_all_objects` no-ops for pg mode.
- photos.py + assets.py upload paths write bytes+thumb into `photo_blobs`; `storage_path=postgres://{id}`; serve endpoints read blob with legacy-MinIO fallback; delete cascades (passive_deletes=True); reports.py export emits `/photos/{id}/file` URL in pg/local modes.
- Alembic migration d4e5f6a7b8c9 creates photo_blobs; added to vanish/wipe list.
- Verified E2E on live stack: upload → blob row (52753 data + 3112 thumb bytes), /file & /thumbnail 200, DELETE 204 (cascade removes blob), legacy MinIO photo still 200. Import smoke test OK (mode=postgres, 101 routes).
- Pre-existing: pytest suite needs external Postgres at :5434 (unreachable here) — not caused by these changes.

## Phase 3 — Organization page (COMPLETE)
- Backend: `roles.py` list_roles / list_permissions / get_role now gated with `require_permission(READ_USER)` (was auth-only — security gap closed).
- New `web/app/(dashboard)/organization/page.tsx` with 3 tabs:
  - **Users & Rights**: table (Name, Email, Phone, Rights, Scope, Status, Actions) + Create/Edit modal — roles (rights) checkboxes, dependent Region→Area→Branch mapping selects, active toggle, create + edit + deactivate.
  - **Org Mapping**: Region cards → Areas → Branches with assigned users per scope (region/area/branch in-charge chips) + branch manager + "Unmapped Users" panel.
  - **Role Rights**: expandable role cards showing each role's permission set (from GET /roles/{id}).
- Sidebar NAV: replaced "Users & Roles" (/users) with "Organization" (/organization, icon 🗂️). Old /users page left in place (removal in Phase 4).
- Verified: `tsc --noEmit` clean; docker compose build web + backend restarted; `/organization` serves 200 via nginx; `/roles`+`/roles/permissions` 200 (admin); role guard active; scope-update backend flow tested live (PATCH user with region/area/branch → 200, revert to null → 200). Data: 3 regions, 3 areas, 10 branches, 4 users (0 mapped → shown as Unmapped until admin maps them).

## Phase 4 — Dead code + hardening (COMPLETE)
- Deleted root scratch/creds files: `.backend_pid`, `.dbg_cl.json`, `.dbg_cl2.json`, `.dbg_item`, `.dbg_photos.json`, `.dbg_token` (contained a live JWT), `.dbg_visit`, `.dbg_visits.json`, `.reset_out.json`, `login.json`, `temp*.json` (7 files), `check_sa_warnings.py`. Also stale root `.next` and empty `.github`.
- Removed unused dependency `aioredis` from backend/requirements.txt (0 imports); de-duped duplicate `bcrypt`; added `gunicorn==23.0.0` (prod workers).
- Deleted superseded `web/app/(dashboard)/users/page.tsx` (replaced by /organization; no source references).
- Kept `mobile/register.tsx` (intentionally wired "registration disabled" screen, not dead) and `backend/admin_static` (actively served at /admin).
- Backend hardening: `SecurityHeadersMiddleware` (X-Content-Type-Options, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy; CSP+HSTS when ENVIRONMENT=production), `DOCS_ENABLED` config (false in prod), `SEED_DEMO` env opt-out in seed.py.

## Phase 5 — AWS Linux deploy package (COMPLETE, config validated)
- `docker-compose.prod.yml` rewritten (was stale: no web service, S3 photos): postgres16 + redis7 + backend (gunicorn 4 uvicorn workers, STORAGE_MODE=postgres, DOCS_ENABLED=false, healthcheck) + web + nginx (TLS) — ECR-friendly image names, env-driven secrets, log rotation. `docker compose config` validates (exit 0).
- `deploy/aws.env.example`, `deploy/nginx.conf` (HTTP→HTTPS redirect, ACME, TLS1.2+, HSTS, static cache), `deploy/setup.sh` (AL2023 bootstrap + secret gen + build + migrate/seed + certbot), `deploy/backup.sh` (pg_dump → gzip → S3 optional; photos included since stored in DB), `deploy/restore.sh`.
- `AWS_DEPLOYMENT_GUIDE.md` (sizing, security groups, runbook, TLS, backups, cost), `CYBERSECURITY_CHECKLIST.md` (auth/RBAC/evidence/transport/secrets/API/server monitoring, with ✅/⬜ status).

## Phase 6 — Final verification (COMPLETE)
- Backend healthy in dev (docs still on for dev, off in prod): `/docs` 200, `/roles` 401 without auth, security headers present.
- Photo E2E in postgres mode re-verified: upload → photo_blobs (52753/3112 bytes), DELETE 204 with blob cascade.
- Web rebuilt: `/organization` 200 via nginx, removed `/users` now 404, dashboard 200.
- Mobile `tsc --noEmit` clean; web tsc clean; prod compose config valid.
## Phase 7 — Super Admin cockpit (COMPLETE)
- Fixed-asset / IT-asset multi-photo evidence (backend + mobile) — see engineering notes in session; migration e6f7a8b9c0d1 applied, live E2E verified (multi-upload, first-photo primary, code-photo linking, per-photo delete, file serving).
- Web Super Admin Dashboard rebuilt as a GitHub-dark glassmorphism cockpit:
  - Fixed collapsible glass sidebar (collapse/expand persisted in localStorage, icon-only rail + floating reopen button, mobile off-canvas overlays).
  - Glass primitives added to components/ui.tsx (GlassPanel, Chip, KpiTile) + gh-* design tokens in tailwind.config.js/globals.css (ambient orbs, backdrop-blur glass, ledger grid, mono numerics, reduced-motion).
  - KPI band (clickable): Total Branches (active only), Total Visits, Total Completed, Pending, In Process — all region-scoped.
  - Regional audit board (per-region compliance/visits board, click to scope) + region filter chips.
  - XLSX-style ledger tabs: Coverage, Visits by User, Checklist Review, Approval, Corrective Actions (sticky headers, mono numerals, totals footer) — every table re-scopes to selected region.
  - Performance analytics (recharts): visit pipeline by region (stacked), compliance by region, corrective-action health, top failing checkpoints, pipeline posture gauges, regional ledger summary.
- Verified: web tsc clean; docker compose build web OK; live QA via headless browser (login, KPI recalc on region click, all 5 ledgers, sidebar collapse persistence, mobile hamburger, charts render; no web/backend errors). Screenshots: %TEMP%\opencode\dashboard_full.png / dashboard_mobile.png / dashboard_top.png.
## Phase 8 — Color allover: dark/glass theme rollout (COMPLETE)
- Extended the GitHub-dark glassmorphism scheme from the dashboard to every page. Shared primitives restyled in `web/components/ui.tsx`: Buttons (primary `bg-[#2f81f7]`, secondary `bg-[#21262d]`, danger `bg-[#da3633]`, success `bg-[#238636]`), Card `bg-gh-panel border-gh-border shadow-glass glass-hover`, Badge bordered, Input/Select `bg-gh-canvas border-[#30363d] focus:ring-[#2f81f7]`, Table dark header/mute + `divide-white/[0.06]`, StatCard dark tones, Spinner `border-[#2f81f7]`, EmptyState `text-gh-faint`.
- Root layout `web/app/(dashboard)/layout.tsx` now paints the canvas for all dashboard pages: `min-h-screen flex bg-gh-canvas text-gh-text`, main wraps content in `gh-canvas gh-scroll p-6 md:p-8 pb-16 min-h-screen relative` with 4 `gh-orb` divs and a `relative z-10` content wrapper. Dashboard `page.tsx` de-nested (its own canvas + `Ambient` component removed). `globals.css` body default darkened (`bg-gh-canvas text-gh-text`).
- Swept every dashboard page (visits, visits/[id], branches, checklists, organization, employees, actions, gallery, reports, reports/[id], audit-logs, settings) + rewritten login (dark glass panel + orbs). Conventions: slate-900→text-gh-text, slate-600/500→text-gh-muted, slate-400→text-gh-faint, slate-300→text-[#484f58], borders→border-gh-border, hover rows→hover:bg-white/[0.04], errors→#f85149, links/accents→#58a6ff, success→#3fb950. Intentional colored badge pills + api.ts STATUS_COLORS maps kept.
- Verified:
  - web `tsc --noEmit` exit 0.
  - `docker compose build web` + image retagging + container recreation (`branchvisitinspectionphotoevidencecompliancemanagementsystem-web` Up).
  - Headless Chrome CDP automated verification across all 14 routes: computed `bodyBg` = `rgb(13, 17, 23)` (#0d1117 dark canvas) on every page, `grayText` = 0 (old slate classes eliminated), `gh-canvas` and `gh-orb` ambient layers active across all dashboard routes.
  - Full screenshot set captured and saved in `%TEMP%\opencode\theme_*.png` (login, dashboard, visits, visit modal, visit detail, branches, checklists, organization, employees, actions, gallery, reports, report detail, audit logs, settings).
## Phase 9 — Employee Master for IT asset verification + production fresh start (COMPLETE)
- Full data wipe executed (`POST /admin/reset` confirm `VANISH`) → deleted 5 users / 10 branches / 22 visits / 32 photos / 5 templates. DB now starts clean: only roles, permissions, super admin.
- `seed(include_demo=False)` now keeps the system baseline (4 visit types + 4 SOP/role checklist templates) but no sample org/demo data — a reset leaves a usable but empty system.
- `Employee_Master.xlsx` (5,313 real employees) import upgraded end-to-end for super admin uploads:
  - Auto-creates missing **regions → areas → branches** from the file's `Region`/`Area`/`Branch` columns via new `_OrgBuilder` (`backend/app/api/employees.py`) — codes generated with the existing `_code_from_name`/`_unique_code`.
  - Parses `Employment Status` → `is_active` (Active/Exited; exited staff never become verification targets), plus optional `State` → branch state.
  - Import result now reports `created_regions`/`created_areas`/`created_branches` (schema `EmployeeImportResult`).
  - Reverse-order/priority column detection fixed for the real header (`Zone, State, Region, Cluster, Area, Branch`).
- Import verified via live API: **5,313 created / 0 skipped; 24 regions, 95 areas, 342 branches created; 3,203 exited marked inactive**.
- Default IT asset types seeded for verification: **Laptop, Charger, Mobile** (active); editable in web Employees page.
- Employees list limit raised (backend `le=20000`, web `limit=10000`) for the 5k+ master.
- Web rebuilt (detached `docker compose build web` → retag → `--force-recreate web`) and verified: `/login` 200, new import UI strings present in the served bundle.
- Remaining manual steps for the user: create/assign regional admin users (region/area/branch scope), schedule visits, verify IT assets in the mobile app (Employees → each employee × asset type → photo & OCR).

## Phase 10 — Branch Audit Checklist import with per-item behavior + sample evidence (COMPLETE)
- Imported the customer's new **`Branch Audit Checklist.xlsx`** (9 sections / 65 checkpoints) into the live `Branch Audit Checklist` v1.0 template from the "Notes for Mayank" column:
  - **"Give photo upload + Remarks + Attach sample photo"** → photo required on OK & NOT_OK, remarks always, sample reference attached.
  - **"Give option to say done + Remarks"** → no photo needed (`photo_allowed=false`), status + remark.
  - Role columns (**Admin / HR / Ops / Others**) → `role_tags` visibility (empty = everyone); **super admin always sees all items** (existing `visits.py` filter + submit-time validation).
- New **sample evidence** feature: checklist_items.sample_refs (JSON) via migration `f8a9b0c1d2e3`; 15 curated sample PDFs (from the customer's Pithampur/Ujjain demo archives) shipped in `backend/app/static_samples/` and served at `/static/samples/` (FastAPI `StaticFiles` mount + nginx `/static/` proxy). Import auto-matches samples by keyword (notice board, fire extinguisher, first aid/medicine, registers, asset, address plate) — 41 of 65 items carry sample references.
- API surface: VisitChecklistItemRead.sample_refs + _serialize_v_item; ChecklistItemRead/Create.sample_refs; PATCH /items/{id} now also accepts `role_tags`/`sample_refs` (super admin can tune items without re-import).
- Mobile (pp/(app)/checklist/[id].tsx): items show a "📎 Sample available" hint and the editor renders a "Sample photo (how to click)" chip that opens the reference PDF via Linking. Web checklists editor shows a `samples:N` badge per item and accepts sample filenames on new checkpoints.
- Deployment: backend image rebuilt (importer + static samples baked), web rebuilt (detached) + retagged + force-recreated, nginx reloaded. Verified: migration head `f8a9b0c1d2e3`, template read shows role_tags/sample_refs/photo config, `/static/notice-board.pdf` and `/static/fire-extinguisher.pdf` return 200 application/pdf, mobile `tsc --noEmit` clean.
- Note: a few photo items (housekeeping, stationery) have no matching sample file — they keep photo+remarks without a reference. "Upload file" hint items (e.g. missing-assets excel) fall back to photo upload (no generic file upload — avoids adding a native mobile dependency).
