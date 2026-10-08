# Asset Capture (OCR) for Regional Admin Visits + Mobile Stats Fix

Date: 2026-09-24
Status: Approved by user (Q&A locked), implemented end-to-end.

## 1. Mobile stats fix
`GET /dashboard/mobile-summary` previously counted `VisitChecklistItem` rows
(930 items) as "Total Visits". Fixed to count **visits** in the user's branch
scope:
- `total_branches`: visible branches (unchanged)
- `total_checklists`: visit count (renamed semantics only)
- `completed_checklists`: visits in APPROVED / CLOSED / CANCELLED
- `pending_checklists`: the rest

Response keys kept so existing mobile home cards keep working; labels aligned
to "Total Visits / Completed / Pending".

## 2. Data model (new tables only — no existing table changes)
- `visit_assets`: fixed assets per visit (category free text, name, code,
  ocr_raw, ocr_confirmed, status, code_photo_id -> photos, creator).
- `employees`: employee master (emp_code unique, name, department, branch_id,
  is_active). Imported from Excel/CSV.
- `it_asset_types`: Laptop / Charger / Mobile + admin-configurable extras
  (active types apply to every employee).
- `visit_it_assets`: one verification row per (visit, employee, asset type),
  unique constraint; pre-created on first open so the inspector just taps,
  scans, confirms.

Asset code photos reuse the existing `photos` pipeline (MinIO/local storage,
thumbnails, `?token=` streaming), so they also appear in the visit photo
gallery for the approver. New alembic revision `c3d4e5f6a7b8`.

## 3. Backend APIs
- Tesseract OCR service (`app/utils/ocr.py`): exif-corrected grayscale +
  autocontrast + threshold binarization + upscale; PSM 6/7; charset filter
  `[A-Za-z0-9/._- ]`; returns normalized text + mean confidence.
- `app/api/assets.py` (visit-scoped via `can_access_branch`):
  - `GET/POST /visits/{id}/assets`, `PATCH/DELETE /visits/{id}/assets/{id}`
  - `POST /visits/{id}/assets/{id}/code-photo` → stores photo + runs OCR,
    returns `{code_photo_id, ocr_text, ocr_confidence}`
  - `GET /visits/{id}/it-assets` (lazily pre-creates expected rows),
    `PATCH /visits/{id}/it-assets/{row_id}`, `POST .../it-assets/{row_id}/code-photo`
- `app/api/employees.py`:
  - `GET /employees` (scoped, searches q/branch_id/department, verified/total
    asset counters), `POST/PATCH/DELETE /employees[/{id}]`
  - `GET /employees/template` (.xlsx template)
  - `POST /employees/import` (.xlsx/.csv, header-synonym parsing, branch
    matched by code then name within user scope, upsert by emp_code)
  - `GET /it-asset-types`, `POST /it-asset-types`, `PATCH /it-asset-types/{id}`
- Tesseract added to the backend image (`tesseract-ocr` apt, `pytesseract`).

## 4. Mobile UI (Expo Go compatible)
- Visit detail gains "Fixed Assets" and "IT Assets" entry buttons.
- Fixed Assets screen: add categories ("Fan", "Chair"...), add asset rows;
  tapping an asset opens camera (scan mode) → upload → OCR autofill into an
  editable code field + "OCR correct?" confirm checkbox (edit/rescan/delete).
- IT Assets screen: employees of the visit's branch with per-employee
  progress; expand → expected asset types; tap type → same camera→OCR→confirm
  flow; status toggle (PENDING / NOT_FOUND / NA / VERIFIED).
- Home stat card labels corrected.

## 5. Web admin UI
- New "Employees" sidebar page: Excel/CSV upload modal, template download,
  search/filter by branch & department, add/edit/disable, verified counters.
- Regional Admin visit detail shows Fixed Assets (grouped by category) and IT
  Assets (per-employee table) with photos, codes and confirm status.

## 6. Seed & deployment
- `seed_assets_demo.py`: creates default IT asset types and demo employees
  for the 8 demo branches via the live API (idempotent).
- Backend image rebuilt (Tesseract); alembic revision for prod; dev relies on
  `create_all`. Verified: API endpoints, `next build`, mobile `tsc`.

## Future extensions (not in scope)
- Per-employee custom IT asset lists; asset-level repair/comment fields;
  fixed assets grouped into reports.