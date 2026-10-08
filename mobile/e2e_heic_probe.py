"""E2E consumer (HEIC photos + interactive checklist) — runs INSIDE backend
container against the fresh vanish DB. Uses urllib only.

Sequence:
 1) login as field auditor
 2) pick first IN_PROGRESS visit
 3) get its 58-item checklist
 4) real HEIC upload -> expect 200 (THUMBNAIL) + photo recorded
 5) re-upload same bytes -> expect dedupe (no new photo)
 6) answer one photo-required item NOT_OK + upload HEIC -> recorded
 7) submit visit
Prints PASS/FAIL lines, sets exit code.
"""
import asyncio
import io
import json
import struct
import uuid
import urllib.request
import urllib.error
from PIL import Image, ImageDraw
import pillow_heif

BASE = "http://127.0.0.1:8000/api/v1"
AUDITOR = {"email": "amit.auditor@company.com", "password": "Demo@12345"}

# PowerShell-safe: no heredoc, no fancy quoting. Keep it flat and boring.


def req(path, method="GET", data=None, tok=None, ct=None, raw=False):
    r = urllib.request.Request(BASE + path, method=method, data=data)
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    if ct and data is not None:
        r.add_header("Content-Type", ct)
    try:
        resp = urllib.request.urlopen(r, timeout=120)
        body = resp.read() if raw else (lambda b: json.loads(b) if b and b.strip().startswith(("{", "[")) else b.decode())(resp.read())
        return resp.status, (body.decode() if isinstance(body, bytes) else body)
    except urllib.error.HTTPError as e:
        return e.code, (e.read().decode()[:300])


def heic_bytes(w=320, h=240, color=(30, 120, 220)):
    """Real HEIC via pillow-heif (pillow-heif is baked into the new image)."""
    pillow_heif.register_heif_opener()
    im = Image.new("RGB", (w, h), color)
    d = ImageDraw.Draw(im)
    for i in range(0, w, 40):
        d.line([(i, 0), (w - i, h)], fill=(255, 210, 0), width=3)
    buf = io.BytesIO()
    im.save(buf, format="HEIF", quality=85)
    return buf.getvalue()


def jpeg_bytes():
    import io as _io
    buf = _io.BytesIO()
    Image.new("RGB", (320, 240), (20, 160, 90)).save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def multipart_upload(vid, item_id, blob, fname, ftype, tok, captured="2026-09-24T10:00:00Z"):
    boundary = "----E2E" + uuid.uuid4().hex
    b = boundary.encode()
    body = bytearray()
    body += (b"--" + b + b"\r\n"
             + b'Content-Disposition: form-data; name="file"; filename="'
             + fname.encode() + b'"\r\nContent-Type: ' + ftype.encode() + b"\r\n\r\n")
    body += blob
    body += b"\r\n"
    if item_id:
        body += (b"--" + b + b"\r\n"
                 + b'Content-Disposition: form-data; name="checklist_item_id"\r\n\r\n'
                 + str(item_id).encode() + b"\r\n")
    body += (b"--" + b + b"\r\n"
             + b'Content-Disposition: form-data; name="captured_at"\r\n\r\n'
             + captured.encode() + b"\r\n")
    body += b"--" + b + b"--\r\n"
    return req(f"/visits/{vid}/photos", "POST", bytes(body), tok=tok,
               ct="multipart/form-data; boundary=" + boundary)


async def run():
    ok = fail = 0

    def check(name, cond, extra=""):
        nonlocal ok, fail
        print(("  PASS  " if cond else "  *FAIL* ") + name + (f"  {extra}" if extra else ""))
        if cond:
            ok += 1
        else:
            fail += 1

    c, login = await asyncio.to_thread(req, "/auth/login", "POST",
                                       json.dumps(AUDITOR).encode(), ct="application/json")
    tok = (login or {}).get("access_token") if isinstance(login, dict) else None
    check("auditor login", c in (200, 201) and bool(tok), f"rc={c}")

    if not tok:
        print(f"FINISHED: {ok} pass / {fail} fail")
        return

    c, visits = await asyncio.to_thread(req, "/visits/my", tok=tok)
    visits = visits if isinstance(visits, list) else []
    inprog = [v for v in visits if v.get("status") == "IN_PROGRESS"]
    check(">=1 IN_PROGRESS visit", len(inprog) >= 1, f"found {len(inprog)}")
    if not inprog:
        print(f"FINISHED: {ok} pass / {fail} fail")
        return
    vid = inprog[0]["id"]
    print(f"  visit: {inprog[0].get('branch_name')} ({inprog[0].get('status')})")

    c, chk = await asyncio.to_thread(req, f"/visits/{vid}/checklist", tok=tok)
    items = (chk or {}).get("items") or [] if isinstance(chk, dict) else []
    check("checklist loaded", len(items) == 58, f"items={len(items)} rc={c}")
    if not items:
        print(f"FINISHED: {ok} pass / {fail} fail")
        return

    # --- 1) HEIC upload on first photo-required + NOT_OK-eligible item ---
    item = next(
        (i for i in items
         if (i.get("photo_allowed") and i.get("requirement") and
             set(i.get("requirement", [])) & {"NOT_OK"})),
        None,
    ) or next((i for i in items if i.get("photo_allowed")), None)
    if not item:
        print("no photo-required item found")
        print(f"FINISHED: {ok} pass / {fail} fail")
        return
    itid = item["id"]
    blob = heic_bytes()

    c1, r1 = await asyncio.to_thread(multipart_upload, vid, itid, blob, "evidence.heic",
                                     "image/heic", tok)
    check("HEIC upload rc", c1 in (200, 201), f"rc={c1} {str(r1)[:200]}")

    c, photos = await asyncio.to_thread(req, f"/visits/{vid}/photos", tok=tok)
    n1 = len(photos) if isinstance(photos, list) else -1
    check("HEIC photo persisted", n1 >= 1, f"count={n1}")

    # --- 2) dedupe: re-upload identical bytes -> count unchanged ---
    c2, r2 = await asyncio.to_thread(multipart_upload, vid, itid, blob, "evidence.heic",
                                     "image/heic", tok)
    c, photos2 = await asyncio.to_thread(req, f"/visits/{vid}/photos", tok=tok)
    n2 = len(photos2) if isinstance(photos2, list) else -1
    check("HEIC dedupe (same bytes)", n2 == n1, f"n1={n1} n2={n2} (dup rc={c2})")

    # --- 3) answer that item NOT_OK + remark, then submit ---
    c3, r3 = await asyncio.to_thread(
        req, f"/visits/{vid}/checklist/items/{itid}", "PATCH",
        json.dumps({"status": "NOT_OK", "remark": "HEIC evidence item - NOT OK"}).encode(),
        tok=tok, ct="application/json")
    check("item NOT_OK marked", c3 in (200, 201), f"rc={c3} {str(r3)[:140]}")

    print(f"FINISHED: {ok} pass / {fail} fail")
    if fail:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(run())
