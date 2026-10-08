"""Seed IT asset types + demo employee master for the Asset Checklist module.

Idempotent: skips types/employees that already exist. Uses the live API so it
also doubles as a smoke test for the new /employees and /it-asset-types
endpoints.

Usage (container):  python seed_assets_demo.py
"""
import json
import urllib.request

BASE = "http://127.0.0.1:8000/api/v1"


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


DEFAULT_TYPES = ["Laptop", "Mobile"]

DEMO_STAFF = [
    # branch (matched by name), emp code, name, department
    ("Demo Mumbai Andheri", "DEMO-EMP-001", "Rahul Sharma", "Operations"),
    ("Demo Mumbai Andheri", "DEMO-EMP-002", "Sneha Kulkarni", "Customer Service"),
    ("Demo Mumbai Borivali", "DEMO-EMP-003", "Priya Patel", "Administration"),
    ("Demo Mumbai Borivali", "DEMO-EMP-004", "Vikram Singh", "Operations"),
    ("Demo Pune Camp", "DEMO-EMP-005", "Amit Verma", "Finance"),
    ("Demo Pune Camp", "DEMO-EMP-006", "Neha Deshmukh", "Customer Service"),
    ("Demo Delhi Karol Bagh", "DEMO-EMP-007", "Rohan Mehta", "Administration"),
    ("Demo Bengaluru MG Road", "DEMO-EMP-008", "Kavya Nair", "Operations"),
    ("Demo Chennai T Nagar", "DEMO-EMP-009", "Arjun Subramanian", "Finance"),
    ("Demo Hyderabad Ameerpet", "DEMO-EMP-010", "Divya Reddy", "Customer Service"),
]


def main():
    c, login = req("/auth/login", "POST", json.dumps({
        "email": "admin@company.com", "password": "change-this-password"}).encode())
    assert c == 200, f"admin login failed ({c})"
    tok = login["access_token"]

    # ---- IT asset types ----
    c, types = req("/it-asset-types", tok=tok)
    existing = {t["name"] for t in types} if isinstance(types, list) else set()
    for name in DEFAULT_TYPES:
        if name not in existing:
            c, t = req("/it-asset-types", "POST",
                       json.dumps({"name": name}).encode(), tok=tok)
            print(f"it-asset-type {name}: {c}")
        else:
            print(f"it-asset-type {name}: exists")

    # ---- Demo employees ----
    c, branches = req("/branches", tok=tok)
    by_name = {b["name"]: b for b in branches}
    c, emps = req("/employees", tok=tok)
    existing_codes = {e["emp_code"] for e in emps} if isinstance(emps, list) else set()

    created = 0
    for branch_name, code, name, dept in DEMO_STAFF:
        if code in existing_codes:
            print(f"employee {code}: exists")
            continue
        branch = by_name.get(branch_name)
        if not branch:
            print(f"employee {code}: SKIP (branch {branch_name} not found)")
            continue
        c, e = req("/employees", "POST", json.dumps({
            "emp_code": code, "name": name, "department": dept,
            "branch_id": branch["id"]}).encode(), tok=tok)
        print(f"employee {code} -> {branch_name}: {c}")
        if c in (200, 201):
            created += 1

    print(f"done. created {created} employees")


if __name__ == "__main__":
    main()