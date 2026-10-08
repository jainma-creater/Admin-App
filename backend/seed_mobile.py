import asyncio
import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent / "app"
sys.path.insert(0, str(APP_DIR))

from sqlalchemy import select  # noqa: E402

from core.database import async_session  # noqa: E402
import models  # noqa: F401, E402
from models.org import Branch  # noqa: E402
from models.asset import Employee, ItAssetType, VisitAsset, VisitItAsset  # noqa: E402
from models.checklist import ChecklistItem  # noqa: E402
from models.visit import Visit, VisitAssignment, VisitType  # noqa: E402
from models.user import User  # noqa: E402

ADMIN_EMAIL = "admin@company.com"

# item-keyword -> sample filenames actually present in static_samples/.
RULES = [
    (("fire extinguisher",), ["fire-extinguisher.pdf", "ujjain-fire-extinguisher.pdf"]),
    (("first aid", "first-aid"), ["first-aid-box.pdf", "ujjain-first-aid-kit.pdf"]),
    (("wall fan",), ["wall-fan.pdf"]),
    (("air cooler", "cooler"), ["air-cooler.pdf", "wall-fan.pdf"]),
    (("cupboard",), ["cupboard.pdf"]),
    (("desktop", "computer"), ["desktop.pdf"]),
    (("chair",), ["chair.pdf"]),
    (("table",), ["table.pdf", "chair.pdf"]),
    (("notice board", "position notice", "gratuity", "holiday list", "aml policy",
      "posh", "whistle", "code of conduct", "minimum wages", "labour", "npa",
      "sma", "maternity", "certificate"), ["ujjain-notice-board.pdf", "notice-board.pdf"]),
    (("register", "reconciliation", "vouchers", "bills", "cash book", "kyc",
      "kyc/aml", "returns", "income", "documentation", "agreement"), ["ujjain-registers.pdf"]),
    (("asset", "tagged", "tag", "scrapped", "scrap"), ["ujjain-asset.pdf", "desktop.pdf"]),
    (("address", "board", "gst", "entrance", "logo", "cin", "branch address"),
     ["address-plate.pdf", "ujjain-notice-board.pdf"]),
]

# Section-level defaults applied when no keyword rule matched.
SECTION_DEFAULTS = {
    "Notice Board": ["ujjain-notice-board.pdf", "notice-board.pdf"],
    "Compliance Registers": ["ujjain-registers.pdf"],
    "Physical Asset Verification": ["ujjain-asset.pdf", "desktop.pdf"],
    "Entrance & GST Board": ["address-plate.pdf", "ujjain-notice-board.pdf"],
    "Stationery": ["cupboard.pdf"],
}

EXTRA_EMPLOYEES = [
    {"emp_code": "DEMO-EMP-011", "name": "Farhan Sheikh", "department": "IT Support", "branch_name": "Demo Mumbai Andheri"},
    {"emp_code": "DEMO-EMP-012", "name": "Ishita Roy", "department": "Operations", "branch_name": "Demo Mumbai Andheri"},
    {"emp_code": "DEMO-EMP-013", "name": "Kunal Gupta", "department": "Customer Service", "branch_name": "Demo Mumbai Andheri"},
    {"emp_code": "DEMO-EMP-014", "name": "Sana Khan", "department": "IT Support", "branch_name": "Demo Mumbai Borivali"},
]

EXTRA_IT_TYPES = [
    ("Laptop", 1),
    ("Mobile", 2),
]


async def run() -> None:
    async with async_session() as db:
        admin = await db.scalar(select(User).where(User.email == ADMIN_EMAIL))
        if not admin:
            raise RuntimeError(f"Admin not found: {ADMIN_EMAIL}")

        # ---------- 1. Populate sample_refs on every checklist item ----------
        sections = (await db.execute(select(models.checklist.ChecklistSection))).scalars().all()
        sec_by_id = {s.id: s for s in sections}
        items = (await db.execute(select(ChecklistItem))).scalars().all()
        changed = 0
        for it in items:
            sec = sec_by_id.get(it.section_id)
            text = (it.name or "").lower() + " " + ((sec.name or "") if sec else "")
            refs = []
            for keywords, files in RULES:
                if any(k in text for k in keywords):
                    refs = files
                    break
            if not refs and sec and sec.name in SECTION_DEFAULTS:
                refs = SECTION_DEFAULTS[sec.name]
            if refs and (it.sample_refs or []) != refs:
                it.sample_refs = refs
                changed += 1
        print(f"sample_refs updated on {changed} items")

        # ---------- 2. Ensure IT / Fixed visit types exist ----------
        for name, desc in [
            ("Fixed Asset Visit", "Regional admin verifies physical fixed assets and tags at the branch."),
            ("IT Asset Visit", "Regional admin / branch ops verify IT assets assigned to employees."),
        ]:
            existing = await db.scalar(select(VisitType).where(VisitType.name == name))
            if not existing:
                db.add(VisitType(name=name, description=desc, is_active=True))
                print(f"created visit type: {name}")

        # ---------- 3. Ensure extra IT asset types exist ----------
        existing_types = {t.name: t for t in (await db.execute(select(ItAssetType))).scalars().all()}
        for tname, order in EXTRA_IT_TYPES:
            if tname not in existing_types:
                db.add(ItAssetType(name=tname, is_active=True, sort_order=order, created_by=admin.id))
                print(f"created it_asset_type: {tname}")

        # ---------- 4. Ensure demo employees exist on the two Mumbai branches ----------
        branches = {b.name: b for b in (await db.execute(select(Branch))).scalars().all()}
        existing_emps = {e.emp_code: e for e in (await db.execute(select(Employee))).scalars().all()}
        for emp in EXTRA_EMPLOYEES:
            if emp["emp_code"] in existing_emps:
                continue
            br = branches.get(emp["branch_name"])
            if not br:
                print(f"skip employee {emp['emp_code']}: branch {emp['branch_name']} not found")
                continue
            db.add(Employee(
                emp_code=emp["emp_code"],
                name=emp["name"],
                department=emp["department"],
                branch_id=br.id,
                is_active=True,
                created_by=admin.id,
            ))
            print(f"created employee: {emp['emp_code']} {emp['name']} @ {emp['branch_name']}")

        await db.commit()

        # ---------- 5. Demo IT Asset Visit at Demo Mumbai Andheri ----------
        it_type = await db.scalar(select(VisitType).where(VisitType.name == "IT Asset Visit"))
        fixed_type = await db.scalar(select(VisitType).where(VisitType.name == "Fixed Asset Visit"))
        anchor = branches.get("Demo Mumbai Andheri")
        anchor2 = branches.get("Demo Mumbai Borivali")

        if it_type and anchor:
            demo_it = (await db.execute(
                select(Visit).where(Visit.instructions == "SEED-DEMO-IT-VISIT")
            )).scalars().first()
            if not demo_it:
                demo_it = Visit(
                    branch_id=anchor.id,
                    visit_type_id=it_type.id,
                    status="DRAFT",
                    priority="MEDIUM",
                    scheduled_date=None,
                    instructions="SEED-DEMO-IT-VISIT",
                    created_by=admin.id,
                )
                db.add(demo_it)
                await db.flush()
                db.add(VisitAssignment(visit_id=demo_it.id, user_id=admin.id, assignment_type="VISITOR"))
                print(f"created demo IT Asset Visit: {demo_it.id}")
            # Pre-create expected IT rows (employees x types) like _ensure_expected_rows
            staff = (await db.execute(
                select(Employee).where(Employee.branch_id == anchor.id, Employee.is_active.is_(True))
            )).scalars().all()
            types = (await db.execute(
                select(ItAssetType).where(ItAssetType.is_active.is_(True)).order_by(ItAssetType.sort_order)
            )).scalars().all()
            existing_rows = (await db.execute(
                select(VisitItAsset).where(VisitItAsset.visit_id == demo_it.id)
            )).scalars().all()
            seen = {(r.employee_id, r.asset_type_id) for r in existing_rows}
            for emp in staff:
                for t in types:
                    if (emp.id, t.id) not in seen:
                        db.add(VisitItAsset(
                            visit_id=demo_it.id, employee_id=emp.id, asset_type_id=t.id,
                            status="PENDING", created_by=admin.id,
                        ))
            await db.flush()
            print(f"IT visit rows: {len(staff)} employees x {len(types)} types")

        if fixed_type and anchor2:
            demo_fx = (await db.execute(
                select(Visit).where(Visit.instructions == "SEED-DEMO-FIXED-VISIT")
            )).scalars().first()
            if not demo_fx:
                demo_fx = Visit(
                    branch_id=anchor2.id,
                    visit_type_id=fixed_type.id,
                    status="DRAFT",
                    priority="MEDIUM",
                    scheduled_date=None,
                    instructions="SEED-DEMO-FIXED-VISIT",
                    created_by=admin.id,
                )
                db.add(demo_fx)
                await db.flush()
                db.add(VisitAssignment(visit_id=demo_fx.id, user_id=admin.id, assignment_type="VISITOR"))
                print(f"created demo Fixed Asset Visit: {demo_fx.id}")
            existing_assets = (await db.execute(
                select(VisitAsset).where(VisitAsset.visit_id == demo_fx.id)
            )).scalars().all()
            if not existing_assets:
                from uuid import uuid4
                for i, (cat, name, code) in enumerate([
                    ("Fan", "Ceiling fan near cashier counter", "MUM002-FAN-001"),
                    ("Chair", "Staff chair - operations desk", None),
                    ("Table", "Customer service table", "MUM002-TBL-001"),
                    ("Locker", "Cash vault / safe locker", "MUM002-LCK-001"),
                    ("Fire Extinguisher", "Kitchen area - ABC 2kg", None),
                ]):
                    db.add(VisitAsset(
                        visit_id=demo_fx.id, category=cat, name=name, code=code,
                        status="VERIFIED" if code else "PENDING",
                        ocr_confirmed=bool(code), sort_order=i, created_by=admin.id,
                    ))
                await db.flush()
                print("seeded fixed asset demo rows")

        await db.commit()
        print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(run())