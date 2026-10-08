"""Persistent, killable OCR worker process.

Protocol (all integers big-endian, 4 bytes):

    parent -> child : <len:u32><jpeg bytes>
    child  -> parent: <len:u32><utf-8 JSON {"text":..., "confidence":...}>

Why a separate process
----------------------
OCR runs PaddleOCR plus a multi-variant Tesseract sweep, and on a small shared
host a single call can take tens of seconds. Running that on a thread means a
timeout *cannot* reclaim the CPU: `Future.cancel()` is a no-op once the thread
has started, so the inference keeps burning cores while the caller has already
been told "skipped". That leak is cumulative - it is why the host drifted to a
load average in the 40s with orphaned `tesseract` processes still running
minutes after the load had finished.

Running OCR here instead lets the parent SIGKILL a runaway child, which really
does free the CPU. The child stays warm between requests so the PaddleOCR model
is loaded once rather than per call.

This module is an entrypoint, not an import: `ocr_runtime` spawns it as
`python -m utils.ocr_child` (or by path) and talks to it over pipes.
"""
from __future__ import annotations

import json
import os
import struct
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))

# Allow both `python -m utils.ocr_child` and a direct path launch. The `utils`
# package root is the *parent* of this file's directory, so put that on the
# path - adding our own directory would make `import utils` fail.
_APP_ROOT = os.path.dirname(_HERE)
if _APP_ROOT not in sys.path:
    sys.path.insert(0, _APP_ROOT)

_LEN = struct.Struct(">I")


def _read_exact(stream, count: int) -> bytes | None:
    """Read exactly `count` bytes, or None on clean/short EOF."""
    chunks: list[bytes] = []
    remaining = count
    while remaining > 0:
        block = stream.read(remaining)
        if not block:
            return None
        chunks.append(block)
        remaining -= len(block)
    return b"".join(chunks)


def main() -> int:
    # Warm the engine once, before the first request is acknowledged, so the
    # parent's read timeout is not spent paying model-load cost. A failure here
    # is not fatal: ocr_code_plate falls back to Tesseract internally.
    try:
        from utils.ocr import _get_paddle  # noqa: F401

        _get_paddle()
    except Exception:
        pass

    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer

    from utils.ocr import ocr_code_plate

    while True:
        header = _read_exact(stdin, _LEN.size)
        if header is None:
            return 0
        (length,) = _LEN.unpack(header)
        if length <= 0 or length > 64 * 1024 * 1024:
            # Nonsensical frame: refuse rather than allocate it.
            return 0
        data = _read_exact(stdin, length)
        if data is None:
            return 0

        try:
            result = ocr_code_plate(data)
            reply = {
                "text": str(result.get("text") or ""),
                "confidence": float(result.get("confidence") or 0.0),
            }
        except Exception as exc:  # noqa: BLE001 - never take the pipe down
            reply = {"text": "", "confidence": 0.0, "error": f"{type(exc).__name__}: {exc}"}

        payload = json.dumps(reply).encode("utf-8")
        stdout.write(_LEN.pack(len(payload)))
        stdout.write(payload)
        stdout.flush()


if __name__ == "__main__":
    raise SystemExit(main())