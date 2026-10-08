from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from core.permissions import Permission
from api.deps import require_permission, get_current_user, is_super_admin, user_role_names
from models.checklist import ChecklistTemplate, ChecklistSection, ChecklistItem
from models.visit import VisitType, Visit
from schemas.checklist import (
    ChecklistTemplateCreate,
    ChecklistTemplateRead,
    ChecklistTemplateMinimal,
    ChecklistSectionCreate,
)
from schemas.visit import VisitTypeCreate, VisitTypeRead
from core.visit_access import allowed_visit_type_names
from utils.audit import AuditLogger

router = APIRouter(prefix="/checklists", tags=["checklists"])


def _user_checklist_tags(user) -> set[str] | None:
    """Checklist tags this user may see, or None for unrestricted viewers
    (super admin / checklist managers / auditors who own the whole library)."""
    if is_super_admin(user):
        return None
    from api.visits import get_user_checklist_tags, EXTRA_CHECKLIST_TAGS
    roles = user_role_names(user)
    if any(r in ("ADMIN", "HOD") for r in roles):
        return None  # template owners / reviewers see the whole library
    if any(r in ("AUDITOR",) for r in roles):
        return None
    tags = set()
    for r in roles:
        from core.permissions import ROLE_TO_CHECKLIST_TAG
        if r in ROLE_TO_CHECKLIST_TAG:
            tags.add(ROLE_TO_CHECKLIST_TAG[r])
        tags |= EXTRA_CHECKLIST_TAGS.get(r, set())
    return tags or set()  # empty set = role with no mapping sees nothing tagged


def _filter_items_by_tags(items: list, tags: set[str] | None) -> list:
    if tags is None:
        return list(items)
    out = []
    for it in items:
        item_tags = set(it.role_tags or [])
        if not item_tags or (tags & item_tags):
            out.append(it)
    return out


def _visible_template_names(user, templates: list) -> set[int]:
    """Template ids that carry at least one item visible to this user.
    A template with NO role-tagged items at all is a shared template —
    visible to everyone."""
    tags = _user_checklist_tags(user)
    if tags is None:
        return {t.id for t in templates}
    out = set()
    for t in templates:
        secs = t.sections or []
        all_items = [i for s in secs for i in (s.items or [])]
        has_tagged = any(i.role_tags for i in all_items)
        visible = _filter_items_by_tags(all_items, tags)
        if visible and (not has_tagged or any(i.role_tags for i in visible)):
            out.add(t.id)
    return out


# ---------- Visit Types ----------

@router.get("/visit-types", response_model=list[VisitTypeRead])
async def list_visit_types(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(VisitType).order_by(VisitType.name))
    types = result.scalars().all()
    allowed = allowed_visit_type_names(current_user, [t.name for t in types])
    for vt in types:
        vt.allowed = vt.name in allowed
    return types


@router.post("/visit-types", response_model=VisitTypeRead, status_code=status.HTTP_201_CREATED)
async def create_visit_type(
    payload: VisitTypeCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vt = VisitType(**payload.model_dump())
    db.add(vt)
    await db.flush()
    return vt


# ---------- Templates ----------

@router.get("/templates", response_model=list[ChecklistTemplateRead])
async def list_templates(
    current_user=Depends(require_permission(Permission.READ_CHECKLIST)),
    db: AsyncSession = Depends(get_db),
):
    """Checklist library. Non-managerial roles (HR, Regional Admin, Branch Ops…)
    only see templates that contain checkpoints tagged for their role — an HR
    login sees the HR checklist, not the whole library."""
    result = await db.execute(
        select(ChecklistTemplate)
        .options(
            selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items)
        )
        .order_by(ChecklistTemplate.name, ChecklistTemplate.version.desc())
    )
    templates = list(result.scalars().all())
    visible_ids = _visible_template_names(current_user, templates)
    templates = [t for t in templates if t.id in visible_ids]

    # Also strip items/sections not tagged for this user inside visible templates.
    tags = _user_checklist_tags(current_user)
    for t in templates:
        for s in list(t.sections or []):
            kept = _filter_items_by_tags(list(s.items or []), tags)
            if tags is not None:
                s.items = kept
        if tags is not None:
            t.sections = [s for s in (t.sections or []) if s.items]
    return templates


@router.get("/templates/active", response_model=list[ChecklistTemplateMinimal])
async def list_active_templates(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Active published templates, scoped to the caller's role tags so the
    mobile/web "start visit" picker only offers checklists meant for them."""
    result = await db.execute(
        select(ChecklistTemplate)
        .options(
            selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items)
        )
        .where(ChecklistTemplate.is_active.is_(True), ChecklistTemplate.is_published.is_(True))
        .order_by(ChecklistTemplate.name)
    )
    templates = list(result.scalars().all())
    visible_ids = _visible_template_names(current_user, templates)
    return [t for t in templates if t.id in visible_ids]


@router.get("/templates/{template_id}", response_model=ChecklistTemplateRead)
async def get_template(
    template_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChecklistTemplate)
        .options(
            selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items)
        )
        .where(ChecklistTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if template.id not in _visible_template_names(current_user, [template]):
        # Hide the existence of other roles' checklists (no content leak via
        # direct-id probing).
        raise HTTPException(status_code=404, detail="Template not found")
    tags = _user_checklist_tags(current_user)
    if tags is not None:
        for s in list(template.sections or []):
            s.items = _filter_items_by_tags(list(s.items or []), tags)
        template.sections = [s for s in (template.sections or []) if s.items]
    return template


@router.post("/templates", response_model=ChecklistTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: ChecklistTemplateCreate,
    current_user=Depends(require_permission(Permission.MANAGE_CHECKLISTS)),
    db: AsyncSession = Depends(get_db),
):
    template = ChecklistTemplate(
        name=payload.name,
        version=payload.version,
        description=payload.description,
        visit_type_id=payload.visit_type_id,
        created_by=current_user.id,
    )
    for sec in payload.sections:
        section = ChecklistSection(
            name=sec.name,
            description=sec.description,
            sort_order=sec.sort_order,
            created_by=current_user.id,
        )
        for item in sec.items:
            section.items.append(ChecklistItem(**item.model_dump(exclude={"id"}), created_by=current_user.id))
        template.sections.append(section)

    db.add(template)
    await db.flush()
    await AuditLogger.log(db, user_id=current_user.id,
                          action="CHECKLIST_CREATED", entity_type="checklist_template", entity_id=template.id)

    # Re-query fully loaded so the response serializes cleanly. Returning the
    # in-memory object crashes when sections were created empty (lazy load
    # outside greenlet context → MissingGreenlet → HTTP 500).
    final = await db.execute(
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
        .where(ChecklistTemplate.id == template.id)
    )
    return final.scalar_one()


@router.patch("/templates/{template_id}", response_model=ChecklistTemplateRead)
async def update_template(
    template_id: UUID,
    payload: dict,
    current_user=Depends(require_permission(Permission.MANAGE_CHECKLISTS)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
        .where(ChecklistTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Do not allow editing a template tied to completed visits in a destructive way;
    # only metadata-level editable fields.
    in_use = await db.execute(
        select(Visit.id).where(
            Visit.template_id == template_id,
            Visit.status.in_(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CLOSED", "REWORK_REQUIRED"]),
        ).limit(1)
    )
    if in_use.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Template is in use by completed visits; create a new version instead")

    allowed_keys = {"name", "description", "is_active", "is_published"}
    for key, value in payload.items():
        if key in allowed_keys:
            setattr(template, key, value)
    template.updated_by = current_user.id

    await AuditLogger.log(db, user_id=current_user.id,
                          action="CHECKLIST_UPDATED", entity_type="checklist_template", entity_id=template.id)
    return template


@router.post("/templates/{template_id}/sections", response_model=ChecklistTemplateRead)
async def add_section(
    template_id: UUID,
    payload: ChecklistSectionCreate,
    current_user=Depends(require_permission(Permission.MANAGE_CHECKLISTS)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
        .where(ChecklistTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    section = ChecklistSection(
        template_id=template.id,
        name=payload.name,
        description=payload.description,
        sort_order=payload.sort_order,
        created_by=current_user.id,
    )
    db.add(section)
    template.updated_by = current_user.id

    # Flush so the section gets an ID before we attach inline items by FK
    # (relationship-append triggers lazy IO during flush in the async session,
    # which crashes with MissingGreenlet).
    await db.flush()
    for item_data in payload.items:
        db.add(ChecklistItem(section_id=section.id, **item_data.model_dump(), created_by=current_user.id))
    await db.flush()

    await AuditLogger.log(db, user_id=current_user.id,
                          action="CHECKLIST_SECTION_ADDED", entity_type="checklist_template", entity_id=template.id)

    # Re-query fully loaded so the response serializes cleanly.
    final = await db.execute(
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
        .where(ChecklistTemplate.id == template_id)
    )
    return final.scalar_one()


@router.post("/sections/{section_id}/items", response_model=ChecklistTemplateRead)
async def add_item(
    section_id: UUID,
    payload: dict,
    current_user=Depends(require_permission(Permission.MANAGE_CHECKLISTS)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChecklistSection).where(ChecklistSection.id == section_id)
    )
    section = result.scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    db.add(ChecklistItem(section_id=section.id, **payload, created_by=current_user.id))
    await db.flush()

    template_id = section.template_id
    await AuditLogger.log(db, user_id=current_user.id,
                          action="CHECKLIST_ITEM_ADDED", entity_type="checklist_template", entity_id=template_id)

    # Re-query fully loaded so the response serializes cleanly.
    final = await db.execute(
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
        .where(ChecklistTemplate.id == template_id)
    )
    return final.scalar_one()


@router.patch("/items/{item_id}")
async def update_item(
    item_id: UUID,
    payload: dict,
    current_user=Depends(require_permission(Permission.MANAGE_CHECKLISTS)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ChecklistItem).where(ChecklistItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    allowed_keys = {
        "name", "description", "response_type", "options", "photo_allowed",
        "photo_required_on", "remark_required_on", "action_required_on",
        "responsible_required_on", "target_date_required_on", "weight",
        "is_required", "is_active", "sort_order", "role_tags", "sample_refs",
    }
    for key, value in payload.items():
        if key in allowed_keys:
            setattr(item, key, value)
    item.updated_by = current_user.id
    return {"message": "Item updated"}


@router.post("/templates/{template_id}/duplicate", response_model=ChecklistTemplateRead)
async def duplicate_template(
    template_id: UUID,
    current_user=Depends(require_permission(Permission.MANAGE_CHECKLISTS)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChecklistTemplate)
        .options(selectinload(ChecklistTemplate.sections).selectinload(ChecklistSection.items))
        .where(ChecklistTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    from models.base import uuid4

    new_template = ChecklistTemplate(
        name=template.name,
        version="DRAFT",
        description=template.description,
        visit_type_id=template.visit_type_id,
        is_active=False,
        is_published=False,
        created_by=current_user.id,
    )
    for sec in template.sections:
        section = ChecklistSection(
            name=sec.name,
            description=sec.description,
            sort_order=sec.sort_order,
            created_by=current_user.id,
        )
        for item in sec.items:
            section.items.append(ChecklistItem(
                name=item.name, description=item.description,
                response_type=item.response_type, options=item.options,
                photo_allowed=item.photo_allowed, photo_required_on=item.photo_required_on,
                remark_required_on=item.remark_required_on, action_required_on=item.action_required_on,
                responsible_required_on=item.responsible_required_on,
                target_date_required_on=item.target_date_required_on,
                weight=item.weight, is_required=item.is_required,
                sort_order=item.sort_order, created_by=current_user.id,
            ))
        new_template.sections.append(section)
    db.add(new_template)
    await db.flush()
    return new_template