"""Seeds roles, permissions, super admin, sample org data, and the SOP checklist."""
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from core.permissions import ROLE_PERMISSIONS, RoleName, Permission
from core.security import get_password_hash
from models.user import Role, Permission as PermissionModel, User
from models.org import Region, Area, Branch
from models.visit import VisitType, Visit, VisitAssignment, VisitChecklistItem
from models.checklist import ChecklistTemplate, ChecklistSection, ChecklistItem


SOP_ITEMS = [
    {
        "section": "Entrance & GST Board",
        "items": [
            {"name": "Entrance display / Outside board present and legible",
             "description": "Verify the external branch signboard is in place, clean and legible."},
            {"name": "GST Board displayed",
             "description": "Verify GST board with registration details is displayed at the entrance."},
            {"name": "GST Number correct on board",
             "description": "Verify the GST number printed matches the branch registration."},
            {"name": "Logo displayed",
             "description": "Verify company logo is displayed at the entrance."},
            {"name": "Branch Address matches",
             "description": "Verify address displayed matches official branch address."},
            {"name": "CIN Number displayed",
             "description": "Verify CIN number is displayed on the board."},
            {"name": "HO Address displayed",
             "description": "Verify Head Office address is displayed."},
        ],
    },
    {
        "section": "Notice Board",
        "items": [
            {"name": "Abstract of Payment of Gratuity (Central) Rules, 1972",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Certificate of Registration (COR) - NHB",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Certificate of Incorporation (COI)",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Holiday List - Local",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "AML Policy",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Maternity Leave Policy",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "NHB/DRS Policy - Circular No. 70/2014-15",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Professional Tax Certificate (RJ and CG not applicable)",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Sexual Harassment / POSH Policy with current POSH members names",
             "description": "Verify POSH policy with current committee member names is displayed."},
            {"name": "Shop & Establishment Certificate",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Labour Act / Applicable Labour Law Policy",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Minimum Wages",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Code of Conduct",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Whistle Blower Policy",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "SMA & NPA Classification - Consumer Awareness Notice",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Certificate for Commencement of Business",
             "description": "Notice available, properly displayed, legible and updated."},
            {"name": "Notice Board Last Updated / Review Date",
             "description": "Verify the review/update date on the notice board is current."},
        ],
    },
    {
        "section": "Physical Asset Verification",
        "items": [
            {"name": "Assets match latest Asset Register",
             "description": "Verify all assets against the latest Asset Register."},
            {"name": "All assets properly tagged",
             "description": "Ensure assets carry their asset tag numbers and capture photos."},
            {"name": "No asset missing / damaged / moved / scrapped / untagged",
             "description": "Highlight missing, damaged, moved, scrapped or untagged assets."},
        ],
    },
    {
        "section": "Compliance Registers",
        "items": [
            {"name": "Key Custodian Register",
             "description": "Register maintained and up to date."},
            {"name": "Cheque Handover Register",
             "description": "Register maintained and up to date."},
            {"name": "Courier Inward/Outward Register",
             "description": "Register maintained and up to date."},
            {"name": "Petty Cash Register",
             "description": "Register maintained and up to date."},
            {"name": "Visitor Register",
             "description": "Register maintained and up to date."},
            {"name": "Fixed Asset Register",
             "description": "Register maintained and up to date."},
            {"name": "Marketing Register",
             "description": "Register maintained and up to date."},
        ],
    },
    {
        "section": "Agreement & Petty Cash",
        "items": [
            {"name": "Branch agreement/documentation available",
             "description": "Verify branch lease/agreement documentation is available."},
            {"name": "Petty cash verified for last 3 months",
             "description": "Verify petty cash records for the last 3 months."},
            {"name": "Original bills available",
             "description": "Verify original bills are available."},
            {"name": "Invoices available",
             "description": "Verify invoices are available."},
            {"name": "Approvals available",
             "description": "Verify approvals exist for the expenses."},
            {"name": "Supporting documents available",
             "description": "Verify supporting documents are available."},
        ],
    },
    {
        "section": "Housekeeping & Washroom",
        "items": [
            {"name": "Overall branch cleanliness",
             "description": "Check overall branch cleanliness and housekeeping."},
            {"name": "Washroom cleaning status",
             "description": "Check washroom cleaning status."},
            {"name": "No maintenance issues",
             "description": "Highlight any maintenance issues found."},
            {"name": "No cleanliness issues",
             "description": "Highlight any cleanliness issues found."},
        ],
    },
    {
        "section": "Stationery",
        "items": [
            {"name": "Stationery storage location known and organized",
             "description": "Check where the stationery is stored."},
            {"name": "Monthly usage records available for last 3 months",
             "description": "Check monthly usage of stationery - last 3 months."},
            {"name": "Physical stock matches recorded stock",
             "description": "Compare physical stationery stock against available records."},
            {"name": "No shortages identified",
             "description": "Identify shortages."},
            {"name": "No excess stock",
             "description": "Identify excess stock."},
            {"name": "Additional requirements noted",
             "description": "Mention additional requirements, if any."},
        ],
    },
]


ROLE_CHECKLISTS = {
    # Each role's visit gets its own focused checklist. All items allow photos
    # so inspectors capture evidence as they go.
    "HR Visit": {
        "description": "HR branch visit checklist: staffing, welfare and records.",
        "sections": [
            {"section": "Staff & Attendance", "items": [
                {"name": "Staff attendance register verified", "description": "Check today's attendance vs sanctioned strength."},
                {"name": "Leave records up to date", "description": "Verify leave balances and approvals are recorded."},
                {"name": "Salary disbursement confirmed", "description": "Confirm last month salaries disbursed on time."},
            ]},
            {"section": "Welfare & Facilities", "items": [
                {"name": "Drinking water & refreshments available", "description": "Check availability and hygiene."},
                {"name": "Staff seating & workspace condition", "description": "Verify clean, adequate workspace."},
                {"name": "First-aid kit available & stocked", "description": "Check expiry dates of items."},
            ]},
            {"section": "HR Compliance", "items": [
                {"name": "POSH policy displayed with committee names", "description": "Verify current POSH display."},
                {"name": "Appointments letters on file", "description": "Sample-check staff appointment letters."},
                {"name": "ESI/PF records maintained", "description": "Verify statutory deductions records."},
            ]},
        ],
    },
    "HO Audit Visit": {
        "description": "Head Office audit checklist: records, cash and governance.",
        "sections": [
            {"section": "Records & Documentation", "items": [
                {"name": "Statutory registers complete", "description": "All required registers maintained and updated."},
                {"name": "Visit reports of previous visits filed", "description": "Previous visit action points closed."},
                {"name": "Agreement & license documents valid", "description": "Check validity of branch documents."},
            ]},
            {"section": "Cash & Banking", "items": [
                {"name": "Petty cash book balanced", "description": "Physical cash matches book balance."},
                {"name": "Bank reconciliation current", "description": "Latest BRS available and matches."},
                {"name": "Vouchers & bills properly filed", "description": "Sequential, stamped and approved."},
            ]},
            {"section": "Governance", "items": [
                {"name": "Delegation of authority followed", "description": "Approvals as per DoA."},
                {"name": "Key custodian record updated", "description": "Key handover entries current."},
            ]},
        ],
    },
    "Compliance Audit Visit": {
        "description": "Compliance audit checklist: regulatory and safety checks.",
        "sections": [
            {"section": "Regulatory", "items": [
                {"name": "KYC/AML documentation in order", "description": "Sample customer files verified."},
                {"name": "NHB returns submitted on time", "description": "Verify latest return acknowledgment."},
                {"name": "Interest rates displayed as mandated", "description": "Board displaying current rates."},
            ]},
            {"section": "Safety & Security", "items": [
                {"name": "Fire extinguisher service valid", "description": "Check pressure and service tag."},
                {"name": "CCTV operational (all cameras working)", "description": "Verify live feed and recording."},
                {"name": "Emergency exits unobstructed", "description": "Doors open freely, signage visible."},
            ]},
            {"section": "Data & Privacy", "items": [
                {"name": "Customer data securely stored", "description": "Locks/cabinets, no papers lying around."},
                {"name": "System password policy followed", "description": "Screens locked, no shared logins."},
            ]},
        ],
    },
}

DEFAULT_ITEM_CONFIG = dict(
    response_type="STATUS",
    options=["OK", "NOT_OK", "NA"],
    photo_allowed=True,
    photo_required_on=["NOT_OK"],
    remark_required_on=["NOT_OK"],
    action_required_on=["NOT_OK"],
    responsible_required_on=["NOT_OK"],
    target_date_required_on=["NOT_OK"],
    weight=1,
    is_required=True,
)


async def seed(db: AsyncSession, include_demo: bool = True) -> None:
    # ---- Permissions ----
    perm_result = await db.execute(select(PermissionModel))
    existing_perms = {p.name: p for p in perm_result.scalars().all()}
    for p in Permission:
        if p.value not in existing_perms:
            perm = PermissionModel(name=p.value, description=p.value.replace("_", " ").title())
            db.add(perm)
            existing_perms[p.value] = perm
    await db.flush()

    # ---- Roles ----
    role_result = await db.execute(select(Role).options(selectinload(Role.permissions)))
    existing_roles = {r.name: r for r in role_result.scalars().all()}
    for role_name, perms in ROLE_PERMISSIONS.items():
        if role_name.value not in existing_roles:
            role = Role(name=role_name.value, description=role_name.value.replace("_", " ").title(), is_system=True)
            role.permissions = [existing_perms[p.value] for p in perms if p.value in existing_perms]
            db.add(role)
        else:
            role = existing_roles[role_name.value]
            role.permissions = [existing_perms[p.value] for p in perms if p.value in existing_perms]
    await db.flush()

    # ---- Super Admin ----
    admin_result = await db.execute(select(User).where(User.email == settings.SUPER_ADMIN_EMAIL))
    admin = admin_result.scalar_one_or_none()
    if not admin:
        super_role = (await db.execute(select(Role).where(Role.name == RoleName.SUPER_ADMIN))).scalar_one()
        admin = User(
            email=settings.SUPER_ADMIN_EMAIL,
            first_name="System",
            last_name="Administrator",
            hashed_password=get_password_hash(settings.SUPER_ADMIN_PASSWORD),
            is_active=True,
        )
        admin.roles = [super_role]
        db.add(admin)
    await db.flush()

    # ---- Visit types ----
    vt_result = await db.execute(select(VisitType))
    existing_vts = {vt.name for vt in vt_result.scalars().all()}
    visit_types = {}
    for name in ("Regional Admin Visit", "HO Audit Visit", "HR Visit", "Compliance Audit Visit"):
        if name not in existing_vts:
            vt = VisitType(name=name)
            db.add(vt)
            await db.flush()
            visit_types[name] = vt
        else:
            vt_result = await db.execute(select(VisitType).where(VisitType.name == name))
            visit_types[name] = vt_result.scalar_one()
    await db.flush()

    # ---- SOP Checklist template ----
    template_result = await db.execute(
        select(ChecklistTemplate).where(
            ChecklistTemplate.name == "Branch Visit Checklist",
            ChecklistTemplate.version == "1.0",
        )
    )
    template = template_result.scalar_one_or_none()
    if not template:
        template = ChecklistTemplate(
            name="Branch Visit Checklist",
            version="1.0",
            description="Initial checklist imported from the Regional Admin Branch Visit SOP.",
            is_active=True,
            is_published=True,
            visit_type_id=visit_types["Regional Admin Visit"].id,
            created_by=admin.id,
        )
        for section_order, section_data in enumerate(SOP_ITEMS):
            section = ChecklistSection(
                name=section_data["section"],
                sort_order=section_order,
                created_by=admin.id,
            )
            for item_order, item_data in enumerate(section_data["items"]):
                section.items.append(ChecklistItem(
                    **DEFAULT_ITEM_CONFIG,
                    name=item_data["name"],
                    description=item_data["description"],
                    sort_order=item_order,
                    created_by=admin.id,
                ))
            template.sections.append(section)
        db.add(template)
        await db.flush()

    # ---- Role-specific checklists (HR / HO Audit / Compliance) ----
    # Each visit type gets its own published template so HR/Admin/HOD see
    # a focused checklist instead of the full regional-admin SOP.
    for vt_name, spec in ROLE_CHECKLISTS.items():
        vt = visit_types.get(vt_name)
        if vt is None:
            continue
        existing = (
            await db.execute(
                select(ChecklistTemplate).where(
                    ChecklistTemplate.name == f"{vt_name} Checklist",
                    ChecklistTemplate.version == "1.0",
                )
            )
        ).scalar_one_or_none()
        if existing:
            continue
        role_template = ChecklistTemplate(
            name=f"{vt_name} Checklist",
            version="1.0",
            description=spec["description"],
            is_active=True,
            is_published=True,
            visit_type_id=vt.id,
            created_by=admin.id,
        )
        for section_order, section_data in enumerate(spec["sections"]):
            section = ChecklistSection(
                name=section_data["section"],
                sort_order=section_order,
                created_by=admin.id,
            )
            for item_order, item_data in enumerate(section_data["items"]):
                section.items.append(ChecklistItem(
                    **DEFAULT_ITEM_CONFIG,
                    name=item_data["name"],
                    description=item_data["description"],
                    sort_order=item_order,
                    created_by=admin.id,
                ))
            role_template.sections.append(section)
        db.add(role_template)
        await db.flush()

    # Data reset (vanish) calls with include_demo=False: stop here — the system
    # restarts with roles, permissions, the super admin, visit types and the
    # SOP checklist templates, but with NO sample org data and NO demo visits.
    if not include_demo:
        return

    # ---- Sample org data ----
    region_result = await db.execute(select(Region).where(Region.code == "WEST"))
    region = region_result.scalar_one_or_none()
    if not region:
        region = Region(name="West", code="WEST", created_by=admin.id)
        db.add(region)
        await db.flush()

        area = Area(name="Mumbai", code="MUM", region_id=region.id, created_by=admin.id)
        db.add(area)
        await db.flush()

        br1 = Branch(
            name="Mumbai Andheri",
            code="MUM-001",
            region_id=region.id,
            area_id=area.id,
            address="Andheri East, Mumbai",
            city="Mumbai",
            state="Maharashtra",
            gst_number="27AAAAAAAA1A1Z5",
            created_by=admin.id,
        )
        br2 = Branch(
            name="Mumbai Borivali",
            code="MUM-002",
            region_id=region.id,
            area_id=area.id,
            address="Borivali West, Mumbai",
            city="Mumbai",
            state="Maharashtra",
            created_by=admin.id,
        )
        db.add_all([br1, br2])
        await db.flush()

    # ---- Demo visits for the mobile app (idempotent) ----
    # The mobile dashboard/visits tabs read GET /visits/my, which only returns
    # visits assigned to the current user. Without these rows both tabs are
    # permanently empty after a fresh install.
    existing_visits = (await db.execute(select(Visit))).scalars().all()
    if not existing_visits and template is not None:
        active_template = (
            await db.execute(
                select(ChecklistTemplate)
                .where(
                    ChecklistTemplate.is_active.is_(True),
                    ChecklistTemplate.is_published.is_(True),
                )
                .order_by(ChecklistTemplate.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        branches = (await db.execute(select(Branch).order_by(Branch.code))).scalars().all()
        today = date.today()

        demo_plan = [
            # (branch_index, days_offset, status, priority)
            (0, 0, "SCHEDULED", "HIGH"),
            (0, -7, "IN_PROGRESS", "MEDIUM"),
            (1, 0, "SCHEDULED", "MEDIUM"),
            (1, -14, "DRAFT", "LOW"),
        ]

        for branch_idx, day_offset, visit_status, priority in demo_plan:
            if branch_idx >= len(branches):
                continue
            visit = Visit(
                branch_id=branches[branch_idx].id,
                visit_type_id=visit_types["Regional Admin Visit"].id,
                template_id=active_template.id if active_template else None,
                status=visit_status,
                priority=priority,
                scheduled_date=today + timedelta(days=day_offset),
                instructions="Demo visit created by seed script.",
                created_by=admin.id,
            )
            db.add(visit)
            await db.flush()
            db.add(VisitAssignment(
                visit_id=visit.id,
                user_id=admin.id,
                assignment_type="VISITOR",
            ))

            # Copy template items into the visit. POST /visits does this via
            # _hydrate_visit_items, but the seed inserts rows directly, which
            # left demo visits with an empty checklist (nothing to answer,
            # nowhere to attach photos).
            if visit_status != "SUBMITTED":
                tpl_items = (
                    await db.execute(
                        select(ChecklistItem)
                        .join(ChecklistSection, ChecklistItem.section_id == ChecklistSection.id)
                        .where(ChecklistSection.template_id == visit.template_id)
                        .order_by(ChecklistSection.sort_order, ChecklistItem.sort_order)
                    )
                ).scalars().all()
                for ci in tpl_items:
                    db.add(VisitChecklistItem(
                        visit_id=visit.id,
                        checklist_item_id=ci.id,
                        created_by=admin.id,
                    ))

    await db.flush()