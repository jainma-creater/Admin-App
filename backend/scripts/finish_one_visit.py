"""One-off: finish one IN_PROGRESS demo visit -> SUBMITTED (with a NOT OK + photo). Pure HTTP."""
import base64
import io
import json
import urllib.request

API = "http://127.0.0.1:8010/api/v1"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def req(path, method="GET", data=None, token=None, multipart=None):
    headers = {}
    body = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if multipart is not None:
        body, ctype = multipart
        headers["Content-Type"] = ctype
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(API + path, data=body, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(r, timeout=30)
        raw = resp.read().decode()
        return resp.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


# login
c, auth = req("/auth/login", "POST", {"email": "admin@company.com", "password": "change-this-password"})
TOK = auth["access_token"]

# find an IN_PROGRESS visit
c, vs = req("/visits?per_page=100", token=TOK)
visits = json.loads(vs) if isinstance(vs, str) else vs
items = visits if isinstance(visits, list) else visits.get("items", visits.get("visits", []))
target = next((v for v in items if v.get("status") in ("IN_PROGRESS", "DRAFT")), None)
if not target:
    print("no in-progress visit; statuses:", [v.get("status") for v in items])
    raise SystemExit(0)
vid = target["id"]
print("target:", target.get("branch_name"), vid)

# multipart upload
boundary = "----demoBoundary" + str(abs(hash(vid)))
mp = (
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="file"; filename="evidence.png"\r\n'
    "Content-Type: image/png\r\n\r\n"
).encode() + PNG + f"\r\n--{boundary}--\r\n".encode()
mp_ct = f"multipart/form-data; boundary={boundary}"

c, cl = req(f"/visits/{vid}/checklist", token=TOK)
cl_items = cl.get("items", [])
notok_item = None
for it in cl_items:
    if it.get("answer"):
        continue
    pro = it.get("photo_required_on") or []
    needs_photo = bool(pro)  # non-empty list means a photo is required
    if not needs_photo:
        c2, r2 = req(f"/visits/{vid}/checklist/items/{it['id']}", "PATCH",
                     {"status": "OK", "remark": "Auto-filled"}, token=TOK)
        if c2 >= 400:
            print("answer fail:", c2, r2[:150])
    elif notok_item is None:
        notok_item = it

if notok_item:
    # upload photo linked to the checklist item via multipart field
    boundary2 = "----demoBoundary2"
    mp2 = (
        f"--{boundary2}\r\n"
        'Content-Disposition: form-data; name="file"; filename="evidence.png"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode() + PNG + (
        f"\r\n--{boundary2}\r\n"
        'Content-Disposition: form-data; name="checklist_item_id"\r\n\r\n'
        f"{notok_item['id']}\r\n--{boundary2}--\r\n"
    ).encode()
    c3, pr = req(f"/visits/{vid}/photos", "POST", token=TOK,
                 multipart=(mp2, f"multipart/form-data; boundary={boundary2}"))
    print("photo upload:", c3, str(pr)[:120])
    c4, ir = req(f"/visits/{vid}/checklist/items/{notok_item['id']}", "PATCH",
                 {"status": "NOT_OK", "remark": "Board not updated",
                  "observation": "Item non-compliant during walkthrough",
                  "action_required": "Rectify and upload fresh evidence within 7 days"}, token=TOK)
    print("NOT_OK answer:", c4, str(ir)[:150])

# answer every remaining photo-required item so the visit can be submitted
remaining = 0
for it in cl_items:
    if it.get("answer") or it.get("is_completed"):
        continue
    if it is not notok_item:
        c7, r7 = req(f"/visits/{vid}/checklist/items/{it['id']}", "PATCH",
                     {"status": "OK", "remark": "Checked, in order"}, token=TOK)
        remaining += 1 if c7 < 400 else 0
print("extra answered:", remaining)

c5, sr = req(f"/visits/{vid}/submit", "POST", {}, token=TOK)
print("submit:", c5, str(sr)[:200])

c6, dash = req("/dashboard", token=TOK)
print("dashboard:", {x["key"]: x["value"] for x in dash.get("cards", [])} if isinstance(dash, dict) else str(dash)[:300])
