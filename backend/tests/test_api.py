import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app")))

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from core.database import Base
from core.config import settings
from core.security import get_password_hash
from models.user import Role, User, user_roles, RefreshToken
from models.org import Region, Area, Branch
from models.visit import VisitType
from models.checklist import ChecklistTemplate, ChecklistSection, ChecklistItem
from main import app

from utils.seed import SOP_ITEMS


@pytest_asyncio.fixture(autouse=True)
async def _clean_db(engine):
    yield
    async with engine.connect() as conn:
        await conn.begin()
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f'TRUNCATE TABLE "{table.name}" RESTART IDENTITY CASCADE'))
        await conn.commit()

# Use a separate test database
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+asyncpg://bv_user:bv_password@localhost:5434/bv_test"
)


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def client(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)

    # override dependency get_db
    from core.database import get_db

    async def override_get_db():
        async with maker() as session:
            yield session
            await session.commit()

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def super_admin(db_session, client):
    role = Role(name="SUPER_ADMIN", description="System admin", is_system=True)
    db_session.add(role)
    await db_session.flush()

    user = User(
        email="admin@test.com",
        first_name="Test",
        last_name="Admin",
        hashed_password=get_password_hash("password123"),
        is_active=True,
    )
    user.roles = [role]
    db_session.add(user)
    await db_session.commit()
    return user


async def _login(client, email, password):
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
async def test_auth_login_success(client, super_admin):
    data = await _login(client, "admin@test.com", "password123")
    assert data["access_token"]
    assert data["refresh_token"]


@pytest.mark.asyncio
async def test_auth_login_invalid_password(client, super_admin):
    res = await client.post("/api/v1/auth/login", json={"email": "admin@test.com", "password": "wrongpass"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_auth_me_requires_token(client, super_admin):
    res = await client.get("/api/v1/users/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_auth_me_with_token(client, super_admin):
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    res = await client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == 200
    assert res.json()["email"] == "admin@test.com"


@pytest.mark.asyncio
async def test_create_region_and_branch(client, super_admin):
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    res = await client.post("/api/v1/branches/regions", json={"name": "Test Region", "code": "TR"}, headers=headers)
    assert res.status_code == 201, res.text
    region = res.json()

    res = await client.post("/api/v1/branches/areas", json={"name": "Test Area", "code": "TA", "region_id": region["id"]}, headers=headers)
    assert res.status_code == 201, res.text
    area = res.json()

    res = await client.post("/api/v1/branches", json={
        "name": "Test Branch", "code": "TB-01", "region_id": region["id"], "area_id": area["id"],
        "city": "Mumbai", "state": "Maharashtra",
    }, headers=headers)
    assert res.status_code == 201, res.text
    branch = res.json()

    # Branch list access
    res = await client.get("/api/v1/branches", headers=headers)
    assert res.status_code == 200
    assert any(b["id"] == branch["id"] for b in res.json())


@pytest.mark.asyncio
async def test_visit_cycle(client, super_admin, db_session):
    """Full workflow: create branch -> create visit -> checklist -> respond -> submit."""
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    # Create a template from the SOP seed data
    res = await client.post("/api/v1/checklists/templates", json={
        "name": "Test Checklist",
        "version": "1.0",
        "sections": [
            {
                "name": "Entrance & GST Board",
                "sort_order": 0,
                "items": [
                    {"name": "GST Board displayed", "response_type": "STATUS",
                     "options": ["OK", "NOT_OK", "NA"], "sort_order": 0}
                ],
            }
        ],
    }, headers=headers)
    assert res.status_code == 201, res.text
    template = res.json()

    # Publish the template
    await client.patch(f"/api/v1/checklists/templates/{template['id']}", json={"is_published": True}, headers=headers)

    # Create visit type
    res = await client.post("/api/v1/checklists/visit-types", json={"name": "Test Visit Type"}, headers=headers)
    visit_type = res.json()

    # Create branch
    res = await client.post("/api/v1/branches/regions", json={"name": "Region2", "code": "R2"}, headers=headers)
    region = res.json()
    res = await client.post("/api/v1/branches/areas", json={"name": "Area2", "code": "A2", "region_id": region["id"]}, headers=headers)
    area = res.json()
    res = await client.post("/api/v1/branches", json={"name": "Visit Branch", "code": "VB", "region_id": region["id"], "area_id": area["id"]}, headers=headers)
    branch = res.json()

    # Update template to be linked to the visit type (via duplicate would be complex;
    # instead create visit and verify template auto-attaches)
    res = await client.post("/api/v1/visits", json={
        "branch_id": branch["id"],
        "visit_type_id": visit_type["id"],
        "priority": "HIGH",
        "scheduled_date": "2026-09-20",
    }, headers=headers)
    assert res.status_code == 201, res.text
    visit = res.json()

    # Checklist should be attached
    assert visit["template_id"] is not None

    # Load checklist
    res = await client.get(f"/api/v1/visits/{visit['id']}/checklist", headers=headers)
    assert res.status_code == 200, res.text
    checklist = res.json()
    assert checklist["total_count"] >= 1

    # Start visit
    res = await client.post(f"/api/v1/visits/{visit['id']}/start", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "IN_PROGRESS"

    # Respond to the item
    item = checklist["items"][0]
    res = await client.patch(
        f"/api/v1/visits/{visit['id']}/checklist/items/{item['id']}",
        json={"status": "OK"},
        headers=headers,
    )
    assert res.status_code == 200, res.text

    # Submit - should fail if incomplete items still exist; we respond to all
    remaining = (await client.get(f"/api/v1/visits/{visit['id']}/checklist", headers=headers)).json()
    for it in remaining["items"]:
        if not it["is_completed"]:
            res = await client.patch(
                f"/api/v1/visits/{visit['id']}/checklist/items/{it['id']}",
                json={"status": "NA"},
                headers=headers,
            )
            assert res.status_code == 200, res.text

    res = await client.post(f"/api/v1/visits/{visit['id']}/submit", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "SUBMITTED"

    # Start review (move to UNDER_REVIEW) then approve
    res = await client.post(f"/api/v1/visits/{visit['id']}/review", headers=headers)
    assert res.status_code == 200, res.text
    res = await client.post(f"/api/v1/visits/{visit['id']}/approve", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "APPROVED"

    # Create corrective action on a closed visit is fine, but on approved:
    # test action creation on the IN_PROGRESS flow separately
    # Report should be accessible
    res = await client.get(f"/api/v1/reports/visits/{visit['id']}", headers=headers)
    assert res.status_code == 200, res.text
    report = res.json()
    assert report["summary"]["total"] >= 1


@pytest.mark.asyncio
async def test_state_transition_guard(client, super_admin):
    """Invalid transitions must be blocked."""
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    res = await client.post("/api/v1/branches/regions", json={"name": "R3", "code": "R3"}, headers=headers)
    region = res.json()
    res = await client.post("/api/v1/branches/areas", json={"name": "A3", "code": "A3", "region_id": region["id"]}, headers=headers)
    area = res.json()
    res = await client.post("/api/v1/branches", json={"name": "B3", "code": "B3", "region_id": region["id"], "area_id": area["id"]}, headers=headers)
    branch = res.json()
    res = await client.post("/api/v1/checklists/visit-types", json={"name": "VT3"}, headers=headers)
    vt = res.json()

    # A published template must exist for the visit to receive checklist items
    # (the submit guard blocks on incomplete items; without a template the visit
    # legitimately has zero items and submits cleanly).
    res = await client.post("/api/v1/checklists/templates", json={
        "name": "Guard Checklist",
        "version": "1.0",
        "sections": [
            {
                "name": "Section",
                "sort_order": 0,
                "items": [
                    {"name": "Check item", "response_type": "STATUS",
                     "options": ["OK", "NOT_OK", "NA"], "sort_order": 0}
                ],
            }
        ],
    }, headers=headers)
    assert res.status_code == 201, res.text
    template = res.json()
    await client.patch(f"/api/v1/checklists/templates/{template['id']}", json={"is_published": True}, headers=headers)

    res = await client.post("/api/v1/visits", json={"branch_id": branch["id"], "visit_type_id": vt["id"]}, headers=headers)
    visit = res.json()

    # Can't approve a DRAFT visit
    res = await client.post(f"/api/v1/visits/{visit['id']}/approve", headers=headers)
    assert res.status_code == 409

    # Can't submit a DRAFT visit directly without completing items
    res = await client.post(f"/api/v1/visits/{visit['id']}/submit", headers=headers)
    assert res.status_code in (400, 409)


@pytest.mark.asyncio
async def test_rbac_forbidden(client, db_session):
    """A user without READ_USER permission cannot list users."""
    role = Role(name="BRANCH_MANAGER", description="branch", is_system=True)
    db_session.add(role)
    await db_session.flush()
    user = User(
        email="bm@test.com",
        first_name="BM",
        last_name="U",
        hashed_password=get_password_hash("password123"),
        is_active=True,
    )
    user.roles = [role]
    db_session.add(user)
    await db_session.commit()

    data = await _login(client, "bm@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    res = await client.get("/api/v1/users", headers=headers)
    assert res.status_code == 403


async def _seed_org(client, super_admin):
    """Create region -> area -> branch and the four public register roles."""
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    res = await client.post("/api/v1/branches/regions", json={"name": "North", "code": "NR"}, headers=headers)
    assert res.status_code == 201, res.text
    region = res.json()
    res = await client.post("/api/v1/branches/areas", json={"name": "Delhi", "code": "ND", "region_id": region["id"]}, headers=headers)
    area = res.json()
    res = await client.post("/api/v1/branches", json={
        "name": "Khan Market", "code": "KM-01", "region_id": region["id"], "area_id": area["id"],
        "city": "New Delhi", "state": "DELHI",
    }, headers=headers)
    branch = res.json()
    return region, area, branch


@pytest.mark.asyncio
async def test_register_options_public(client, super_admin, db_session):
    region, area, branch = await _seed_org(client, super_admin)

    # No auth required
    res = await client.get("/api/v1/auth/register-options")
    assert res.status_code == 200, res.text
    body = res.json()
    assert any(r["role"] == r_role for r in body["roles"] for r_role in ["HR", "REGIONAL_ADMIN", "BRANCH_MANAGER", "AUDITOR"])
    assert any(
        reg["name"] == "North" and any(a["name"] == "Delhi" and any(b["id"] == branch["id"] for b in a["branches"]) for a in reg["areas"])
        for reg in body["regions"]
    )


@pytest.mark.asyncio
async def test_register_branch_manager_scoped(client, super_admin, db_session):
    region, area, branch = await _seed_org(client, super_admin)
    for name in ["HR", "REGIONAL_ADMIN", "BRANCH_MANAGER", "AUDITOR"]:
        db_session.add(Role(name=name, description=name, is_system=False))
    await db_session.commit()

    res = await client.post("/api/v1/auth/register", json={
        "first_name": "Om", "last_name": "Gupta", "email": "om@branch.local",
        "password": "secret123", "role": "BRANCH_MANAGER",
        "region_id": region["id"], "area_id": area["id"], "branch_id": branch["id"],
    })
    assert res.status_code == 201, res.text
    tokens = res.json()
    assert tokens["access_token"] and tokens["refresh_token"]

    # Auto-login works and the user is scoped to the chosen branch.
    me = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["branch_id"] == branch["id"]
    assert body["region_id"] == region["id"]
    assert body["area_id"] == area["id"]
    assert any(r["name"] == "BRANCH_MANAGER" for r in body["roles"])

    # Branch-scoped list must contain only the assigned branch.
    branches = await client.get("/api/v1/branches", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert branches.status_code == 200
    listed = branches.json()
    assert isinstance(listed, list) and all(b["id"] == branch["id"] for b in listed)


@pytest.mark.asyncio
async def test_register_branch_ops_requires_branch(client, super_admin, db_session):
    region, area, branch = await _seed_org(client, super_admin)
    db_session.add(Role(name="BRANCH_MANAGER", description="branch", is_system=False))
    await db_session.commit()

    res = await client.post("/api/v1/auth/register", json={
        "first_name": "Om", "last_name": "Gupta", "email": "om2@branch.local",
        "password": "secret123", "role": "BRANCH_MANAGER",
    })
    assert res.status_code == 400
    assert "branch" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_register_duplicate_email(client, super_admin, db_session):
    region, area, branch = await _seed_org(client, super_admin)
    for name in ["HR", "BRANCH_MANAGER"]:
        db_session.add(Role(name=name, description=name, is_system=False))
    await db_session.commit()

    payload = {
        "first_name": "Om", "last_name": "Gupta", "email": "dup@branch.local",
        "password": "secret123", "role": "BRANCH_MANAGER",
        "region_id": region["id"], "area_id": area["id"], "branch_id": branch["id"],
    }
    res = await client.post("/api/v1/auth/register", json=payload)
    assert res.status_code == 201
    res = await client.post("/api/v1/auth/register", json=payload)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_register_rejects_unknown_role(client, super_admin):
    res = await client.post("/api/v1/auth/register", json={
        "first_name": "Om", "last_name": "Gupta", "email": "skip@branch.local",
        "password": "secret123", "role": "SUPER_ADMIN",
    })
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_register_rejects_weak_password(client, super_admin):
    # Below schema min length -> pydantic 422.
    res = await client.post("/api/v1/auth/register", json={
        "first_name": "Om", "last_name": "Gupta", "email": "weak@branch.local",
        "password": "short1", "role": "HR",
    })
    assert res.status_code == 422
    # Length OK but no digit -> policy 400.
    res = await client.post("/api/v1/auth/register", json={
        "first_name": "Om", "last_name": "Gupta", "email": "nodigit@branch.local",
        "password": "abcdefgh", "role": "HR",
    })
    assert res.status_code == 400
    assert "number" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_register_rejects_invalid_email(client, super_admin):
    res = await client.post("/api/v1/auth/register", json={
        "first_name": "Om", "last_name": "Gupta", "email": "not-an-email",
        "password": "secret123", "role": "HR",
    })
    assert res.status_code == 400
    res = await client.post("/api/v1/auth/register", json={
        "first_name": "Om", "last_name": "Gupta", "email": "user@nodomain",
        "password": "secret123", "role": "HR",
    })
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_refresh_rotation_and_reuse_detection(client, super_admin):
    """Rotated refresh tokens are revoked; replaying one nukes all sessions."""
    data = await _login(client, "admin@test.com", "password123")
    first_refresh = data["refresh_token"]

    res = await client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert res.status_code == 200, res.text
    second = res.json()
    assert second["access_token"] and second["refresh_token"] != first_refresh

    # Replaying the rotated (now revoked) token must 401 AND revoke everything.
    res = await client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert res.status_code == 401

    # Even the freshly issued token for this user is now dead.
    res = await client.post("/api/v1/auth/refresh", json={"refresh_token": second["refresh_token"]})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_change_password_revokes_refresh_tokens(client, super_admin):
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    res = await client.post("/api/v1/auth/change-password",
                            json={"current_password": "password123", "new_password": "NewPass@123"},
                            headers=headers)
    assert res.status_code == 200, res.text

    # Old refresh token no longer works.
    res = await client.post("/api/v1/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert res.status_code == 401

    # Old password fails, new one works.
    res = await client.post("/api/v1/auth/login", json={"email": "admin@test.com", "password": "password123"})
    assert res.status_code == 401
    res = await client.post("/api/v1/auth/login", json={"email": "admin@test.com", "password": "NewPass@123"})
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_must_change_password_gate(client, db_session):
    role = Role(name="HR", description="hr", is_system=False)
    db_session.add(role)
    await db_session.flush()
    user = User(
        email="forced@test.com",
        first_name="Forced",
        last_name="User",
        hashed_password=get_password_hash("password123"),
        is_active=True,
        must_change_password=True,
    )
    user.roles = [role]
    db_session.add(user)
    await db_session.commit()

    data = await _login(client, "forced@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    # All endpoints are gated until the password is changed...
    res = await client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "PASSWORD_CHANGE_REQUIRED"

    # ...except the change-password flow itself.
    res = await client.post("/api/v1/auth/change-password",
                            json={"current_password": "password123", "new_password": "NewPass@123"},
                            headers=headers)
    assert res.status_code == 200, res.text

    res = await client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_photo_pipeline_strips_exif_and_verifies_checksum(client, super_admin):
    """Uploaded evidence must not retain EXIF/GPS metadata, and the stored
    bytes must match the recorded SHA-256 (tamper evidence check works)."""
    import io as _io
    from PIL import Image, ImageOps

    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    # Org + visit scaffolding (same as the register tests).
    res = await client.post("/api/v1/branches/regions", json={"name": "E", "code": "ER"}, headers=headers)
    region = res.json()
    res = await client.post("/api/v1/branches/areas", json={"name": "EA", "code": "EA", "region_id": region["id"]}, headers=headers)
    area = res.json()
    res = await client.post("/api/v1/branches", json={"name": "EB", "code": "EB", "region_id": region["id"], "area_id": area["id"]}, headers=headers)
    branch = res.json()
    res = await client.post("/api/v1/checklists/visit-types", json={"name": "EVT"}, headers=headers)
    vt = res.json()
    res = await client.post("/api/v1/visits", json={"branch_id": branch["id"], "visit_type_id": vt["id"]}, headers=headers)
    visit = res.json()

    # Build a JPEG whose EXIF carries a camera model + GPS coordinates.
    from PIL.ExifTags import IFD

    img = Image.new("RGB", (640, 480), (200, 30, 30))
    exif = Image.Exif()
    exif[0x0110] = "LeakedCameraModel"
    exif[0x0132] = "2026:09:29 10:00:00"
    exif[IFD.GPSInfo] = {1: "N", 2: (28, 37, 12), 3: "E", 4: (77, 12, 30)}
    buf = _io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    upload_bytes = buf.getvalue()

    res = await client.post(
        f"/api/v1/visits/{visit['id']}/photos",
        files={"file": ("evidence.jpg", upload_bytes, "image/jpeg")},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    photo = res.json()

    # Streaming back the stored evidence: EXIF and GPS must be gone.
    res = await client.get(f"/api/v1/photos/{photo['id']}/file", headers=headers)
    assert res.status_code == 200
    with Image.open(_io.BytesIO(res.content)) as out:
        ex = out.getexif()
        assert 0x0110 not in ex, "camera model EXIF leaked"
        assert 0x8825 not in ex, "GPS EXIF leaked"

    # Stored hash must recompute to the same value (no silent corruption/tamper).
    res = await client.get(f"/api/v1/photos/{photo['id']}/checksum", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["verified"] is True
    assert body["recomputed_sha256"] == body["stored_sha256"]


@pytest.mark.asyncio
async def test_photo_upload_idempotent_retry(client, super_admin):
    """A photo retried with the same X-Device-Id + X-Idempotency-Key must not
    create duplicate evidence (the offline sync safety property)."""
    import io as _io
    from PIL import Image

    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    res = await client.post("/api/v1/branches/regions", json={"name": "I", "code": "IR"}, headers=headers)
    region = res.json()
    res = await client.post("/api/v1/branches/areas", json={"name": "IA", "code": "IA", "region_id": region["id"]}, headers=headers)
    area = res.json()
    res = await client.post("/api/v1/branches", json={"name": "IB", "code": "IB", "region_id": region["id"], "area_id": area["id"]}, headers=headers)
    branch = res.json()
    res = await client.post("/api/v1/checklists/visit-types", json={"name": "IVT"}, headers=headers)
    vt = res.json()
    res = await client.post("/api/v1/visits", json={"branch_id": branch["id"], "visit_type_id": vt["id"]}, headers=headers)
    visit = res.json()

    buf = _io.BytesIO()
    Image.new("RGB", (320, 240), (10, 200, 30)).save(buf, format="JPEG")
    upload_bytes = buf.getvalue()

    idem_headers = {
        **headers,
        "X-Device-Id": "test-device-0001",
        "X-Idempotency-Key": "client-photo-uuid-0001",
    }

    res = await client.post(
        f"/api/v1/visits/{visit['id']}/photos",
        files={"file": ("e1.jpg", upload_bytes, "image/jpeg")},
        headers=idem_headers,
    )
    assert res.status_code == 201, res.text
    first = res.json()

    # Replay with a different body but the same key: no duplicate row created.
    res = await client.post(
        f"/api/v1/visits/{visit['id']}/photos",
        files={"file": ("e2.jpg", upload_bytes, "image/jpeg")},
        headers=idem_headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["id"] == first["id"], "idempotent replay must return the same photo"

    res = await client.get(f"/api/v1/visits/{visit['id']}/photos", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) == 1, "duplicate evidence was created"

    # A different key is a genuinely new photo.
    res = await client.post(
        f"/api/v1/visits/{visit['id']}/photos",
        files={"file": ("e3.jpg", upload_bytes, "image/jpeg")},
        headers={**idem_headers, "X-Idempotency-Key": "client-photo-uuid-0002"},
    )
    assert res.status_code == 201, res.text
    res = await client.get(f"/api/v1/visits/{visit['id']}/photos", headers=headers)
    assert len(res.json()) == 2


@pytest.mark.asyncio
async def test_visit_create_idempotent(client, super_admin):
    """POST /visits with the same device+key returns the original visit."""
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    res = await client.post("/api/v1/branches/regions", json={"name": "V", "code": "VR"}, headers=headers)
    region = res.json()
    res = await client.post("/api/v1/branches/areas", json={"name": "VA", "code": "VA", "region_id": region["id"]}, headers=headers)
    area = res.json()
    res = await client.post("/api/v1/branches", json={"name": "VB", "code": "VB", "region_id": region["id"], "area_id": area["id"]}, headers=headers)
    branch = res.json()
    res = await client.post("/api/v1/checklists/visit-types", json={"name": "VVT"}, headers=headers)
    vt = res.json()

    idem_headers = {
        **headers,
        "X-Device-Id": "test-device-visits",
        "X-Idempotency-Key": "offline-visit-abc-123",
    }
    body = {"branch_id": branch["id"], "visit_type_id": vt["id"]}

    res = await client.post("/api/v1/visits", json=body, headers=idem_headers)
    assert res.status_code == 201, res.text
    first = res.json()

    res = await client.post("/api/v1/visits", json=body, headers=idem_headers)
    assert res.status_code == 201, res.text
    assert res.json()["id"] == first["id"], "visit replay must reuse the created visit"


@pytest.mark.asyncio
async def test_metrics_and_request_id(client, super_admin):
    """/metrics exposes Prometheus-format counters and every response carries
    an X-Request-Id for log correlation / support."""
    data = await _login(client, "admin@test.com", "password123")
    headers = {"Authorization": f"Bearer {data['access_token']}", "X-Request-Id": "req-abc-123"}

    res = await client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == 200
    assert res.headers.get("X-Request-Id") == "req-abc-123", "client request id must be echoed"

    res = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {data['access_token']}"})
    assert res.status_code == 200
    assert res.headers.get("X-Request-Id"), "server must generate a request id when absent"

    res = await client.get("/metrics")
    assert res.status_code == 200, res.text
    assert "bv_http_requests_total" in res.text
    assert "bv_http_latency_seconds_sum" in res.text
    assert "bv_uptime_seconds" in res.text