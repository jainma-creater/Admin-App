"""Server-side OCR for asset code plates (PaddleOCR primary, Tesseract fallback).

The mobile app cannot bundle an OCR engine (Expo Go), so code plates are
photographed and OCR'd here. Real captures are full-scene photos where the
plate text is small relative to the frame, so unlike a naive binarize-and-read
we:

- decode high-resolution source bytes (not the lossy thumbnail),
- PRIMARY: PaddleOCR (PP-OCRv5 detection + recognition) — deep-learning text
  detection finds small plate text anywhere in the scene without binarization
  guesswork and reads curved/angled plates Tesseract misses,
- FALLBACK: staged Tesseract sweep (fast downscaled pass, full-resolution
  multi-variant sweep with polarity copies + 2x upscale, focused plate-band
  crops with adaptive binarization) for the rare frame Paddle cannot read,
- score candidate lines by how much they look like a code plate and return the
  best one together with its confidence.

PaddleOCR is loaded lazily (first call warms the models, ~1s) and guarded so
any engine failure degrades to Tesseract instead of failing the upload."""
import io
import os
import re
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageChops, ImageFilter, ImageOps

import pytesseract

try:
    import pillow_heif  # noqa: F401

    pillow_heif.register_heif_opener()
except ImportError:
    pass

_ALLOWED = re.compile(r"[^A-Za-z0-9/._\- ]+")
_NOISE = re.compile(r"scanned\s*by|camscanner|whatsapp|instagram|@[a-z0-9_]+", re.IGNORECASE)
# Common slab formats found on laptop/mobile asset plates: "IT/1234/2024",
# "SVN/IT/0042", "HR-0142", "DEL/N02/117". Two-or-more alnum runs joined by
# a separator. Used to rank candidate lines.
_SLAB_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/._\- ]{2,60}$")


def _open_gray(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    try:
        ImageOps.exif_transpose(img, in_place=True)
    except Exception:
        pass
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
    return ImageOps.grayscale(img)


def _upscale(img: Image.Image, factor: int) -> Image.Image:
    if factor <= 1:
        return img
    w, h = img.size
    return img.resize((w * factor, h * factor), Image.LANCZOS)


_MAX_SIDE = 2400   # resolution tier for the hard-read sweep
_FAST_SIDE = 1600  # resolution tier for the common easy read
_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-_. "

# ---------------------------------------------------------------------------
# Bounded tesseract fan-out
# ---------------------------------------------------------------------------
# Every `pytesseract.image_to_*` call forks a separate `tesseract` *process*.
# The escalation ladder below used to build its own
# `ThreadPoolExecutor(max_workers=4)` per stage, so one `ocr_code_plate` call
# could have ~4 forks live per stage across two stages on top of the fast pass.
# Three gunicorn workers doing that concurrently put well over a hundred forked
# processes onto a 4-vCPU host - which is what drove load average into the 40s
# and left the box unusable while scanning.
#
# A single process-wide pool caps total tesseract concurrency regardless of how
# many escalation stages or callers are active, so fan-out is bounded by
# construction rather than per-stage.
_TESS_WORKERS = max(1, int(os.getenv("OCR_TESS_WORKERS", "2")))
_tess_pool = ThreadPoolExecutor(max_workers=_TESS_WORKERS, thread_name_prefix="tess")


def _fanout(fn, items: list) -> list:
    """Apply `fn` to every item on the shared bounded tesseract pool.

    Serial for a single item: submitting one job to the pool would only add
    queueing latency. Per-item failures are dropped rather than raised so one
    pathological crop cannot fail an otherwise-good plate read.
    """
    items = list(items)
    if not items:
        return []
    if len(items) == 1:
        try:
            return [fn(items[0])]
        except Exception:
            return []
    out = []
    for fut in [_tess_pool.submit(fn, it) for it in items]:
        try:
            out.append(fut.result())
        except Exception:
            continue
    return out


def _tess_config(psm: int) -> str:
    return f"--psm {psm} -c tessedit_char_whitelist={_CHARSET}"


def _prepare(img: Image.Image, max_side: int) -> Image.Image:
    """Resize + autocontrast a grayscale capture to the given resolution tier."""
    w, h = img.size
    longest = max(w, h)
    if longest < 1600:
        scale = min(1.5, 1600 / longest)
    elif longest > max_side:
        scale = max_side / longest
    else:
        scale = 1.0
    if scale != 1.0:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    return ImageOps.autocontrast(img)


def _binary(img: Image.Image) -> list[Image.Image]:
    """Dark-on-light and light-on-dark polarity copies of a frame."""
    dark_on_light = img.point(lambda p: 0 if p < 150 else 255)
    light_on_dark = img.point(lambda p: 255 if p < 150 else 0)
    return [dark_on_light, light_on_dark]


def _adaptive_binary(img: Image.Image) -> list[Image.Image]:
    """Shadow-robust binarization for uneven plate lighting.

    A plain global threshold fails when part of the frame is in shadow: the
    shadowed background can go darker than the ink. Local mean thresholding
    (box blur via PIL, s + C style) keeps text visible across the whole frame.
    """
    try:
        blurred = img.filter(ImageFilter.BoxBlur(15))
    except Exception:
        return _binary(img)
    # d = original - local_mean; text is a sharp local dip (or rise).
    diff = ImageChops.subtract(img, blurred)          # dark text on light bg
    diff_inv = ImageChops.subtract(blurred, img)      # light text on dark bg
    out = []
    for d in (diff, diff_inv):
        # d in 0..255; threshold the delta at 12 (≈ local contrast needed).
        out.append(d.point(lambda p: 0 if p < 12 else 255))
    return out


def _band(img: Image.Image, y0: float, y1: float) -> Image.Image:
    """Horizontal band of an image (fractions of height), upscaled 2x —
    plate text lives in one line; cropping it gives Tesseract a much bigger
    glyph size to chew on."""
    w, h = img.size
    top = max(0, int(h * y0))
    bottom = min(h, int(h * y1))
    if bottom - top < 20:
        return img
    band = img.crop((0, top, w, bottom))
    return _upscale(band, 2)


def _plate_regions(img: Image.Image) -> list[Image.Image]:
    """Candidate text-line crops for the focused second pass.

    Uses the word boxes from the failed first pass to jump straight to the
    most likely band; falls back to fixed overlapping bands plus a center
    crop when no boxes exist.
    """
    regions: list[Image.Image] = []
    h = img.size[1]
    fixed = [(0.0, 0.4), (0.3, 0.7), (0.6, 1.0), (0.15, 0.85)]
    regions.extend(_band(img, a, b) for a, b in fixed)
    # Center square crop — phone photos often center the plate.
    w, hh = img.size
    side = min(w, hh)
    left, top = (w - side) // 2, (hh - side) // 2
    regions.append(_upscale(img.crop((left, top, left + side, top + side)), 2))
    return regions


def _escalation_images(full: Image.Image) -> list[Image.Image]:
    """Full-resolution sweep: grayscale, both binary polarities, and for small
    originals a 2x upscale (plus its binaries) to recover fine plate text."""
    images = [full]
    images.extend(_binary(full))
    if max(full.size) * 2 <= 3200:
        up = _upscale(full, 2)
        images.append(up)
        images.extend(_binary(up))
    return images


def _normalize_word(word: str) -> str:
    return _ALLOWED.sub("", word).strip()


def _group_lines(words: list[tuple]) -> list[list[tuple]]:
    """Group (left, top, width, height, text, conf) tuples into text lines."""
    if not words:
        return []
    heights = [w[3] for w in words if w[3] > 0]
    med = sorted(heights)[len(heights) // 2] if heights else 12
    tol = max(12.0, med * 0.7)

    ordered = sorted(words, key=lambda w: (w[1] + w[3] / 2.0, w[0]))
    lines: list[list[tuple]] = []
    cur: list[tuple] = []
    cur_centers: list[float] = []
    for w in ordered:
        yc = w[1] + w[3] / 2.0
        if cur and yc - (sum(cur_centers) / len(cur_centers)) > tol:
            lines.append(cur)
            cur = []
            cur_centers = []
        cur.append(w)
        cur_centers.append(yc)
    if cur:
        lines.append(cur)
    for ln in lines:
        ln.sort(key=lambda w: w[0])
    return lines


def _line_score(line: str) -> float:
    if not line:
        return 0.0
    score = 0.0
    score += 6.0 * line.count("/")
    score += 1.5 if "-" in line else 0.0
    score += 0.5 * sum(1 for ch in line if ch.isalnum())
    score -= 1.0 * sum(1 for ch in line if not (ch.isalnum() or ch in "/-_. "))
    if "/" in line:
        score += 8.0
    # Slab-shaped codes (letters+digits, sane length, has a separator or a
    # digit run) are exactly what asset plates print — boost them.
    if _SLAB_RE.match(line):
        score += 4.0
        if any(ch.isdigit() for ch in line):
            score += 2.0
    return score


def _is_code_line(line: str) -> bool:
    """A promising plate code: slash-separated with real alphanumeric content."""
    if "/" not in line:
        return False
    segments = [s for s in line.split("/") if s.strip()]
    if not segments:
        return False
    alnum = sum(1 for ch in line if ch.isalnum())
    return alnum >= 6 and len(segments) >= 2 and all(len(s) >= 1 for s in segments)


def _extract_candidates(im: Image.Image, psm: int) -> list[tuple]:
    """Word-level OCR for one variant + psm. Returns (score, text, confidence)."""
    try:
        data = pytesseract.image_to_data(
            im, lang="eng", config=_tess_config(psm), output_type=pytesseract.Output.DICT
        )
    except Exception:
        return []

    words = []
    n = len(data.get("text", []))
    for i in range(n):
        raw = data["text"][i]
        try:
            conf = int(data["conf"][i])
        except (TypeError, ValueError):
            continue
        if conf < 40:
            continue
        word = _normalize_word(raw)
        if not word or _NOISE.search(word):
            continue
        words.append(
            (data["left"][i], data["top"][i], data["width"][i], data["height"][i], word, conf)
        )
    if not words:
        return []

    cands = []
    for line in _group_lines(words):
        text = " ".join(w[4] for w in line).strip()
        if not text:
            continue
        # Drop junk fragments (bare punctuation, single chars, lone slashes)
        if len(text) < 3 or text.replace("/", "").replace("-", "").replace("_", "").replace(".", "").strip() == "":
            continue
        conf = round(sum(w[5] for w in line) / len(line), 1)
        # Require some real readable content to enter the pool
        if _is_code_line(text) or sum(1 for ch in text if ch.isalnum()) >= 4:
            cands.append((_line_score(text), text, conf, _is_code_line(text)))
        else:
            cands.append((0.0, text, conf, False))
    return cands


def _fallback_blocks(im: Image.Image) -> list[tuple]:
    """Block-level OCR used when word extraction returns nothing."""
    cands = []
    for psm in (3, 6, 11):
        try:
            raw = pytesseract.image_to_string(im, lang="eng", config=_tess_config(psm))
        except Exception:
            continue
        for line in raw.splitlines():
            line = _ALLOWED.sub("", line).strip()
            if not line or len(line) < 3 or _NOISE.search(line):
                continue
            cands.append((_line_score(line), line, 0.0, _is_code_line(line)))
    return cands


def _render_best(candidates: list[tuple]) -> dict:
    """Pick the best code-like line from a candidate pool."""
    if not candidates:
        return {"text": "", "confidence": 0.0}

    # Prefer genuine code lines; never return bare punctuation.
    coded = [c for c in candidates if c[3]]
    pool = coded or candidates
    score, text, conf, is_code = max(pool, key=lambda c: (c[0], c[2]))
    if not is_code and len(text) < 4:
        near = [c for c in coded if c[2] >= 40]
        if near:
            score, text, conf, is_code = max(near, key=lambda c: (c[0], c[2]))
        else:
            return {"text": "", "confidence": 0.0}
    return {"text": text, "confidence": conf}


def _read_best(img: Image.Image) -> dict:
    """Staged OCR: fast pass → full-res sweep → focused plate regions.

    The common case (plate readable at moderate resolution) returns after a
    single Tesseract call on the downscaled grayscale frame, so overall latency
    stays low. Hard reads escalate to the full multi-variant sweep, then to a
    focused pass over banded/cropped plate regions with adaptive binarization
    (survives shadows and glare that defeat global thresholds)."""
    fast = _prepare(img, _FAST_SIDE)
    for psm in (6, 3, 11):
        c = _extract_candidates(fast, psm)
        coded = [x for x in c if x[3]]
        decent = [x for x in coded if x[2] >= 45]
        if decent:
            return _render_best(c)

    full = _prepare(img, _MAX_SIDE)
    images = _escalation_images(full)
    candidates: list[tuple] = []
    for got in _fanout(
        lambda pair: _extract_candidates(pair[0], pair[1]),
        [(im, psm) for im in images for psm in (3, 6, 11)],
    ):
        candidates.extend(got)

    if candidates:
        best = _render_best(candidates)
        if best["text"]:
            return best

    # Focused plate-region pass: crop likely text bands, apply shadow-robust
    # adaptive binarization, and read each variant. Crops make glyphs big;
    # adaptive polarity handles uneven lighting.
    plate_candidates: list[tuple] = []
    regions = _plate_regions(full)
    variants: list[Image.Image] = []
    for r in regions:
        variants.extend(_adaptive_binary(r))
    for got in _fanout(
        lambda pair: _extract_candidates(pair[0], pair[1]),
        [(v, psm) for v in variants for psm in (7, 6, 11)],
    ):
        plate_candidates.extend(got)

    if plate_candidates:
        coded = [c for c in plate_candidates if c[3]]
        pool = coded or plate_candidates
        best = _render_best(pool)
        if best["text"]:
            return best

    for im in images:
        blk = _fallback_blocks(im)
        if blk:
            return _render_best(blk)
    return {"text": "", "confidence": 0.0}


# ---------------------------------------------------------------------------
# PaddleOCR primary engine
# ---------------------------------------------------------------------------

_paddle_ocr = None  # lazy singleton


def _get_paddle():
    """Lazily construct the PaddleOCR engine (models download/warm on first call)."""
    global _paddle_ocr
    if _paddle_ocr is None:
        from paddleocr import PaddleOCR

        _paddle_ocr = PaddleOCR(
            lang="en",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
        )
    return _paddle_ocr


def _paddle_read(img: Image.Image) -> dict:
    """Read text lines with PaddleOCR. Returns the best code-like line.

    PaddleOCR returns [box, (text, confidence)] per detected line. We score
    every line with the same plate heuristic as the Tesseract path so the
    two engines produce comparable candidates."""
    import numpy as np

    result = _get_paddle().predict(np.array(img.convert("RGB")))
    candidates: list[tuple] = []
    for page in result:
        texts = page.get("rec_texts") or []
        scores = page.get("rec_scores") or []
        for text, conf in zip(texts, scores):
            line = _ALLOWED.sub("", str(text)).strip()
            if not line or len(line) < 3 or _NOISE.search(line):
                continue
            conf = float(conf) * 100.0
            if _is_code_line(line) or sum(1 for ch in line if ch.isalnum()) >= 4:
                candidates.append((_line_score(line), line, conf, _is_code_line(line)))
    if not candidates:
        return {"text": "", "confidence": 0.0}
    return _render_best(candidates)


def ocr_code_plate(data: bytes) -> dict:
    """Run OCR on raw photo bytes. Returns {"text", "confidence"}.

    Primary: PaddleOCR on the full-resolution frame. Falls back to the staged
    Tesseract sweep when Paddle is unavailable, fails, or reads nothing.
    """
    img = _open_gray(data)

    try:
        best = _paddle_read(img)
        if best.get("text"):
            return best
    except Exception:
        pass  # engine missing/models not ready/degraded — fall through

    return _read_best(img)