"""Seed rich demo data so the dashboard looks alive.

Creates: HR/Ops/Field staff users, regions with areas, branches, visits in
varied states (in-progress / submitted / approved), checklist answers with
NOT OK findings (which auto-raise corrective actions), and a few photos.
Idempotent: skips if demo branches already exist.

Usage (container):  python seed_demo.py
"""
import asyncio
import json
import random
import sys
import urllib.request
import struct
import zlib
from pathlib import Path

BASE = "http://127.0.0.1:8000/api/v1"  # inside the backend container


def req(path, method="GET", data=None, tok=None, ct="application/json"):
    r = urllib.request.Request(BASE + path, method=method, data=data)
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    if ct and data is not None:
        r.add_header("Content-Type", ct)
    try:
        resp = urllib.request.urlopen(r, timeout=30)
        body = resp.read().decode()
        return resp.status, (json.loads(body) if body and body.strip().startswith(("{", "[")) else body)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def tiny_png():
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00" + b"\x30\x60\xd0" * 4))
            + chunk(b"IEND", b""))


def main():
    c, login = req("/auth/login", "POST", json.dumps({
        "email": "admin@company.com", "password": "change-this-password"}).encode())
    assert c == 200, "admin login failed"
    tok = login["access_token"]

    # ---- skip if demo data exists ----
    c, branches = req("/branches", tok=tok)
    if any(b["name"].startswith("Demo ") for b in branches):
        print("Demo data already present — skipping.")
        return

    # ---- staff users ----
    c, roles = req("/roles", tok=tok)
    role_id = {r["name"]: r["id"] for r in roles}
    users = {}
    for email, fn, ln, role in [
        ("priya.hr@company.com", "Priya", "Sharma", "HR"),
        ("rahul.ops@company.com", "Rahul", "Verma", "BRANCH_MANAGER"),
        ("amit.auditor@company.com", "Amit", "Patel", "AUDITOR"),
    ]:
        c, u = req("/users", "POST", json.dumps({
            "email": email, "first_name": fn, "last_name": ln,
            "password": "Demo@12345", "role_ids": [role_id[role]],
            "is_active": True}).encode(), tok=tok)
        if c in (200, 201):
            users[email] = u["id"]
            print(f"user {email}: {c}")
        else:
            c2, ulist = req("/users", tok=tok)
            match = next((x for x in ulist if x["email"] == email), None)
            users[email] = match["id"] if match else None
            print(f"user {email}: {c} ({u if isinstance(u, str) else 'existing'})")

    # ---- regions / areas / branches ----
    region_ids, area_ids, branch_ids = {}, {}, {}
    for rname in ["West", "North", "South"]:
        c, r = req("/branches/quick-add", "POST", json.dumps({"type": "region", "name": rname}).encode(), tok=tok)
        if c == 201:
            region_ids[rname] = r["id"]
        else:
            c2, rs = req("/branches/regions", tok=tok)
            region_ids[rname] = next(x["id"] for x in rs if x["name"] == rname)

    demo_branches = [
        ("Demo Mumbai Andheri", "West", "Mumbai", "Maharashtra"),
        ("Demo Mumbai Borivali", "West", "Mumbai", "Maharashtra"),
        ("Demo Pune Camp", "West", "Pune", "Maharashtra"),
        ("Demo Delhi Karol Bagh", "North", "Delhi", "Delhi"),
        ("Demo Gurugram Sector 14", "North", "Gurugram", "Haryana"),
        ("Demo Bengaluru MG Road", "South", "Bengaluru", "Karnataka"),
        ("Demo Chennai T Nagar", "South", "Chennai", "Tamil Nadu"),
        ("Demo Hyderabad Ameerpet", "South", "Hyderabad", "Telangana"),
    ]
    for bname, rname, city, state in demo_branches:
        c, b = req("/branches/quick-add", "POST", json.dumps({
            "type": "branch", "name": bname, "region_id": region_ids[rname],
            "city": city, "state": state}).encode(), tok=tok)
        if c == 201:
            branch_ids[bname] = b["id"]
        else:
            c2, bs = req("/branches", tok=tok)
            branch_ids[bname] = next(x["id"] for x in bs if x["name"] == bname)

    # ---- visit type + template ----
    c, vts = req("/checklists/visit-types", tok=tok)
    vtid = vts[0]["id"] if vts else None
    c, tpls = req("/checklists/templates", tok=tok)
    tpl = next((t for t in tpls if "Branch" in t["name"]), None) or (tpls[0] if tpls else None)
    assert tpl, "Branch checklist template not found"

    png = tiny_png()

    def upload_photo(vid, item_id, idx):
        boundary = "----bvseed"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"demo{idx}.png\"\r\n"
                f"Content-Type: image/png\r\n\r\n").encode() + png + \
               (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"checklist_item_id\"\r\n\r\n{item_id}\r\n--{boundary}--\r\n").encode()
        r = urllib.request.Request(f"{BASE}/visits/{vid}/photos", method="POST", data=body)
        r.add_header("Authorization", "Bearer " + tok)
        r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        try:
            urllib.request.urlopen(r, timeout=30)
            return True
        except Exception:
            return False

    random.seed(7)
    plan = [
        ("Demo Mumbai Andheri",   "IN_PROGRESS", 14),
        ("Demo Mumbai Borivali",  "SUBMITTED",   58),
        ("Demo Pune Camp",        "SUBMITTED",   58),
        ("Demo Delhi Karol Bagh", "IN_PROGRESS", 22),
        ("Demo Gurugram Sector 14","SUBMITTED",  58),
        ("Demo Bengaluru MG Road","COMPLETED",   58),
        ("Demo Chennai T Nagar",  "COMPLETED",   58),
        ("Demo Hyderabad Ameerpet","IN_PROGRESS", 9),
    ]
    photo_idx = 0
    for bname, target, answer_count in plan:
        bid = branch_ids[bname]
        c, v = req("/visits", "POST", json.dumps({
            "branch_id": bid, "template_id": tpl["id"], "visit_type_id": vtid,
            "visitor_ids": [u for u in users.values() if u][:1],
        }).encode(), tok=tok)
        if c != 201:
            print(f"visit {bname}: FAIL {c} {v}")
            continue
        vid = v["id"]
        c, cl = req(f"/visits/{vid}/checklist", tok=tok)
        items = cl["items"]
        answered = 0
        for it in items[:answer_count]:
            roll = random.random()
            if roll < 0.18:
                status, remark = "NOT_OK", "Not in place / invalid"
            elif roll < 0.28:
                status, remark = "NA", "Not applicable at this branch"
            else:
                status, remark = "OK", "Checked and found in order"
            payload = {"status": status, "remark": remark}
            if status == "NOT_OK":
                payload["observation"] = "Item missing or non-compliant during walkthrough"
                payload["action_required"] = "Rectify and upload fresh evidence within 7 days"
            c, r = req(f"/visits/{vid}/checklist/items/{it['id']}", "PATCH",
                       json.dumps(payload).encode(), tok=tok)
            if c == 200:
                answered += 1
                if status in ("OK", "NOT_OK") and photo_idx < 24 and random.random() < 0.6:
                    photo_idx += 1
                    upload_photo(vid, it["id"], photo_idx)
        if target == "SUBMITTED":
            req(f"/visits/{vid}/submit", "POST", b"{}", tok=tok)
        elif target == "COMPLETED":
            req(f"/visits/{vid}/submit", "POST", b"{}", tok=tok)
            # approve to reach Completed (chain used by the console review panel)
            c, rv = req(f"/visits/{vid}/review", "POST",
                        json.dumps({"action": "APPROVE", "comment": "Demo approval"}).encode(), tok=tok)
            if c not in (200, 201):
                # fallback: approve endpoint variant
                req(f"/visits/{vid}/approve", "POST", json.dumps({"comment": "Demo approval"}).encode(), tok=tok)
        print(f"visit {bname}: {target} ({answered} answered)")

    c, dash = req("/dashboard", tok=tok)
    cards = {x["key"]: x["value"] for x in dash.get("cards", [])}
    print("dashboard now:", cards)


if __name__ == "__main__":
    main()
