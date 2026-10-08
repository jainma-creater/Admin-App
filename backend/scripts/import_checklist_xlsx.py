"""
Import 'Branch Audit Checklist - Main.xlsx' into a checklist template.

Excel columns:
  A Discription        -> section name (forward-filled)
  B Check Point        -> item name (main item)
  C Notes for Mayank   -> "Give photo upload..." = photo required; "Give option to say done" = done-only (no photo)
  D Details            -> item instructions (description), can contain multiple sub-items separated by newlines
  E-H Admin/HR/Ops/Others -> role tags (Yes = visible for that role)

Each row in the Excel represents a main check point with optional sub-items in the Details column.
Sub-items in Details are separated by newlines and may be numbered (1., 2., etc.)

Idempotent: if a template with the same name+version exists it is replaced.

Usage (from repo root):
  docker compose exec -T backend python scripts/import_checklist_xlsx.py "/app/../Branch Audit Checklist - Main.xlsx"
  # or locally: python backend/scripts/import_checklist_xlsx.py "Branch Audit Checklist - Main.xlsx"
"""
import asyncio
import sys
from pathlib import Path

import openpyxl

APP_DIR = Path(__file__).resolve().parent.parent / "app"
sys.path.insert(0, str(APP_DIR))

from core.database import async_session, engine, Base  # noqa: E402
import models  # noqa: F401, E402  (register all models)
from models.checklist import ChecklistTemplate, ChecklistSection, ChecklistItem  # noqa: E402
from models.visit import VisitType  # noqa: E402
from sqlalchemy import select  # noqa: E402

TEMPLATE_NAME = "Branch Audit Checklist"
TEMPLATE_VERSION = "1.0"
DONE_HINTS = ("option to say done", "say done", "mark done")

# Sample reference evidence (PDFs served from /static/samples/) matched by
# keyword against the item name + notes + description. These come from the
# customer's own 'Audit Evidence - Pithampur/Ujjain' demo archives so the
# field user sees a real example of how to click each photo.
SAMPLE_KEYWORD_MAP = [
    ("notice board", ["notice-board.pdf", "ujjain-notice-board.pdf"]),
    ("fire extinguisher", ["fire-extinguisher.pdf", "ujjain-fire-extinguisher.pdf"]),
    ("first aid", ["first-aid-box.pdf", "ujjain-first-aid-kit.pdf"]),
    ("medicine", ["first-aid-box.pdf"]),
    ("registers", ["ujjain-registers.pdf"]),
    ("register", ["ujjain-registers.pdf"]),
    ("asset", ["ujjain-asset.pdf"]),
    ("outside building", ["address-plate.pdf"]),
    ("display board", ["address-plate.pdf"]),
    ("gst board", ["address-plate.pdf"]),
]

# Section whose certificate/document photo items all reference the notice board
# picture as their sample (every item there is a 'click & upload' doc check).
NOTICE_BOARD_SECTION = "Notice Board – Complete Document Checklist"


def match_sample_refs(name: str, description: str, notes: str, section: str) -> list[str]:
    needle = f"{name} {description or ''} {notes}".lower()
    refs: list[str] = []
    for keyword, files in SAMPLE_KEYWORD_MAP:
        if keyword in needle:
            for f in files:
                if f not in refs:
                    refs.append(f)
    if not refs and section == NOTICE_BOARD_SECTION:
        refs = ["notice-board.pdf", "ujjain-notice-board.pdf"]
    return refs


def parse(path: str):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    header = [str(c).strip().lower() if c else "" for c in next(ws.iter_rows(max_row=1, values_only=True))]
    col = {name: i for i, name in enumerate(header)}
    # required columns
    for req in ("discription", "check point", "details"):
        if req not in col:
            raise SystemExit(f"Missing column '{req}' in Excel. Found: {header}")

    sec_order, items = [], []
    last_sec = None
    for row in ws.iter_rows(min_row=2, values_only=True):
        desc = str(row[col["discription"]]).strip() if row[col["discription"]] else ""
        cp = str(row[col["check point"]]).strip() if row[col["check point"]] else ""
        notes = str(row[col["notes for mayank"]]).lower() if col.get("notes for mayank") is not None and row[col["notes for mayank"]] else ""
        details = str(row[col["details"]]).strip() if row[col["details"]] else ""
        roles_raw = {}
        for label in ("admin", "hr", "ops", "others"):
            v = row[col[label]] if col.get(label) is not None and row[col[label]] else ""
            roles_raw[label] = str(v).strip().lower() == "yes"

        if desc:
            last_sec = desc
            if last_sec not in sec_order:
                sec_order.append(last_sec)
        if not cp:
            continue
        
        photo_required = bool(notes) and ("photo" in notes)
        done_only = bool(notes) and any(h in notes for h in DONE_HINTS)
        role_tags = [label.upper() for label, yes in roles_raw.items() if yes]
        sample_refs = match_sample_refs(cp, details, notes, last_sec or "General") if (photo_required or "sample photo" in notes) else []

        # Add main check point (Details column used as description, not sub-items)
        items.append({
            "section": last_sec or "General",
            "name": cp,
            "description": details or None,
            "photo_required": photo_required,
            "done_only": done_only,
            "role_tags": role_tags,
            "sample_refs": sample_refs,
        })

    return sec_order, items


async def run(path: str) -> None:
    sec_order, items = parse(path)
    if not items:
        raise SystemExit("No items parsed from the Excel file.")
    print(f"Parsed {len(sec_order)} sections / {len(items)} items")

    async with async_session() as db:
        async with db.begin():
            # --- idempotency: replace existing template with same name+version ---
            existing = (
                await db.execute(
                    select(ChecklistTemplate).where(
                        ChecklistTemplate.name == TEMPLATE_NAME,
                        ChecklistTemplate.version == TEMPLATE_VERSION,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                await db.delete(existing)
                await db.flush()

            # --- visit type (optional link) ---
            vt = (await db.execute(select(VisitType).where(VisitType.name == "Branch Visit"))).scalar_one_or_none()
            if not vt:
                vt = VisitType(name="Branch Visit", description="Standard branch audit visit")
                db.add(vt)
                await db.flush()

            tpl = ChecklistTemplate(
                name=TEMPLATE_NAME,
                version=TEMPLATE_VERSION,
                description=f"Imported from {Path(path).name} — {len(items)} checkpoints",
                is_active=True,
                is_published=True,
                visit_type_id=vt.id,
            )
            db.add(tpl)
            await db.flush()

            for si, sec_name in enumerate(sec_order):
                sec = ChecklistSection(
                    template_id=tpl.id,
                    name=sec_name,
                    sort_order=si,
                )
                db.add(sec)
                await db.flush()
                sec_items = [it for it in items if it["section"] == sec_name]
                for ii, it in enumerate(sec_items):
                    db.add(ChecklistItem(
                        section_id=sec.id,
                        name=it["name"][:300],
                        description=it["description"],
                        response_type="STATUS",
                        options=["OK", "NOT_OK", "NA"],
                        photo_allowed=not it["done_only"],
                        # photo mandatory on OK (NOT_OK photos are evidence too, keep allowed)
                        photo_required_on=["OK", "NOT_OK"] if it["photo_required"] else [],
                        remark_required_on=["OK", "NOT_OK", "NA"],
                        action_required_on=["NOT_OK"],
                        role_tags=it["role_tags"],
                        sample_refs=it["sample_refs"],
                        is_required=True,
                        sort_order=ii,
                    ))
    print(f"Imported template '{TEMPLATE_NAME}' v{TEMPLATE_VERSION}: {len(sec_order)} sections, {len(items)} items.")
    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        # default: look for the file next to the repo root
        default = Path(__file__).resolve().parent.parent.parent / "Branch Audit Checklist - Main.xlsx"
        if not default.exists():
            raise SystemExit("Usage: python import_checklist_xlsx.py <path-to-xlsx>")
        path = str(default)
    else:
        path = sys.argv[1]
    if not Path(path).exists():
        raise SystemExit(f"File not found: {path}")
    asyncio.run(run(path))