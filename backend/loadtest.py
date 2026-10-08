#!/usr/bin/env python3
"""Load test harness for the Branch Visit API.

Runs a ramp of concurrent virtual users against the *public* gateway (so the
measurement covers the whole real path: nginx -> Next.js rewrite -> gunicorn
workers -> Postgres/Redis), not just the backend container.

Why X-Forwarded-For is set
--------------------------
The API rate limiter keys on the first hop of X-Forwarded-For (see
api/utils client_ip), which nginx populates from the real socket peer. A load
generator runs from ONE address, so without synthetic XFF every "user" would
share a single rate-limit bucket and the run would measure 429s instead of
capacity. Synthetic per-VU addresses model distinct inspectors, which is what
the limiter is designed to see.

Usage
-----
  # unauthenticated (health + metadata endpoints, no credentials needed)
  python loadtest.py --base http://15.206.56.34/branch-visit/api/v1 --stages 100,200

  # authenticated read mix (branches/employees/visits/checklists)
  python loadtest.py --base http://... --token "$TOKEN" --stages 100,200

  # include the photo/OCR path (writes evidence photos to a demo visit)
  python loadtest.py --base http://... --token "$TOKEN" --visit-id <uuid> --with-photos
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import threading
import time
from dataclasses import dataclass, field

try:
    import requests
except ImportError:
    sys.exit("this harness needs `requests` (pip install requests)")

from PIL import Image
import io


# --------------------------------------------------------------------------
# Result accounting
# --------------------------------------------------------------------------
@dataclass
class Result:
    label: str
    latencies: list[float] = field(default_factory=list)
    statuses: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    # Statuses that are an expected outcome rather than a failure. Without a
    # token the authed mix legitimately returns 401, which must not be counted
    # as an error or an unauthenticated run looks like a total outage.
    expected: set[str] = field(default_factory=set)

    def add(self, status: str, ms: float, err: str | None = None) -> None:
        self.latencies.append(ms)
        self.statuses[status] = self.statuses.get(status, 0) + 1
        if err and len(self.errors) < 5:
            self.errors.append(err)

    @property
    def failures(self) -> dict[str, int]:
        return {s: c for s, c in self.statuses.items()
                if not s.startswith("2") and s not in self.expected}

    def pct(self, p: float) -> float:
        if not self.latencies:
            return 0.0
        ordered = sorted(self.latencies)
        # Nearest-rank percentile: with a few hundred samples this is stable
        # and never interpolates a latency that was never observed.
        k = max(0, min(len(ordered) - 1, int(round(p / 100.0 * len(ordered) + 0.5)) - 1))
        return ordered[k]


class Collector:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.results: dict[str, Result] = {}

    def rec(self, label: str, status: str, ms: float, err: str | None = None) -> None:
        with self._lock:
            r = self.results.setdefault(label, Result(label))
            r.add(status, ms, err)

    def reset(self) -> None:
        with self._lock:
            self.results = {}

    def snapshot(self) -> dict[str, Result]:
        with self._lock:
            return dict(self.results)


# --------------------------------------------------------------------------
# Workload
# --------------------------------------------------------------------------
READ_MIX = [
    ("health", "/health", 2),
    ("register-options", "/auth/register-options", 2),
    ("branches", "/branches?limit=200", 4),
    ("branches-regions", "/branches/regions", 2),
    ("employees", "/employees?limit=200", 4),
    ("visits", "/visits?limit=50", 4),
    ("checklist-templates", "/checklists/templates", 2),
]


def make_image(seed: int, size: int = 1600) -> bytes:
    """Synthetic plate-ish JPEG so the photo path does real decode/compress/OCR."""
    img = Image.new("RGB", (size, size), (240, 240, 235))
    # A few dark bars standing in for printed characters on a code plate.
    for i in range(6):
        x = 120 + i * 90
        img.paste((20, 20, 20), (x, 700, x + 55, 900))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality= 88)
    return buf.getvalue()


class VirtualUser(threading.Thread):
    """One simulated inspector: loops the request mix until stopped."""

    def __init__(self, idx: int, args, token: str | None, collector: Collector,
                 deadline: float, photo_bytes: bytes | None) -> None:
        super().__init__(daemon=True)
        self.idx = idx
        self.args = args
        self.token = token
        self.col = collector
        self.deadline = deadline
        self.photo_bytes = photo_bytes
        # Distinct synthetic client address per user (see module docstring).
        self.client_ip = f"10.{(idx >> 16) & 255}.{(idx >> 8) & 255}.{idx & 255}"
        self.session = requests.Session()

    def _headers(self, auth: bool) -> dict:
        h = {"X-Forwarded-For": self.client_ip, "Accept": "application/json"}
        if auth and self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _get(self, label: str, path: str, auth: bool) -> None:
        url = self.args.base.rstrip("/") + path
        t0 = time.perf_counter()
        try:
            r = self.session.get(url, headers=self._headers(auth), timeout=self.args.timeout)
            ms = (time.perf_counter() - t0) * 1000
            self.col.rec(label, str(r.status_code), ms)
        except Exception as exc:  # noqa: BLE001 - we want the class name
            ms = (time.perf_counter() - t0) * 1000
            self.col.rec(label, type(exc).__name__, ms, f"{label}: {exc}")

    def _photo(self) -> None:
        """Exercise decode + compress + store + OCR on the code-plate endpoint."""
        url = (self.args.base.rstrip("/") +
               f"/visits/{self.args.visit_id}/it-assets/{self.args.it_row_id}/code-photo")
        files = {"file": ("plate.jpg", self.photo_bytes, "image/jpeg")}
        t0 = time.perf_counter()
        try:
            r = self.session.post(url, files=files, headers=self._headers(True),
                                  timeout=self.args.photo_timeout)
            ms = (time.perf_counter() - t0) * 1000
            self.col.rec("photo-code-ocr", str(r.status_code), ms)
        except Exception as exc:  # noqa: BLE001
            ms = (time.perf_counter() - t0) * 1000
            self.col.rec("photo-code-ocr", type(exc).__name__, ms, f"photo: {exc}")

    def run(self) -> None:
        import random

        # Build the weighted pool from a copy: extending `pool` while iterating
        # it would append forever (each new tuple is itself visited).
        pool: list = []
        for label, path, weight in READ_MIX:
            pool.extend([(label, path)] * weight)

        rnd = random.Random(self.idx * 7919 + 13)
        think = max(0.0, self.args.think_ms) / 1000.0
        while time.monotonic() < self.deadline:
            label, path = rnd.choice(pool)
            self._get(label, path, auth=bool(self.token) and label not in ("health", "register-options"))

            if self.args.with_photos and self.photo_bytes and rnd.random() < self.args.photo_ratio:
                self._photo()

            # Think time keeps each virtual user at a believable request rate
            # instead of an unbounded busy-loop. Set 0 for a closed-loop
            # saturation test (max throughput), keep >0 for a realistic one.
            if think:
                time.sleep(think * (0.5 + rnd.random()))
        self.session.close()


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------
def health_probe(base: str, stop: threading.Event, out: list) -> None:
    """Sample /health while the stage runs so we can see OCR capacity."""
    url = base.rstrip("/") + "/health"
    while not stop.is_set():
        try:
            r = requests.get(url, timeout=10)
            if r.ok:
                out.append(r.json())
        except Exception:  # noqa: BLE001
            pass
        stop.wait(2.0)


def run_stage(users: int, seconds: int, args, token, collector, photo_bytes) -> dict:
    collector.reset()
    deadline = time.monotonic() + seconds
    stop = threading.Event()
    health: list = []
    probe = threading.Thread(target=health_probe, args=(args.base, stop, health), daemon=True)
    probe.start()

    vus = [VirtualUser(i, args, token, collector, deadline, photo_bytes) for i in range(users)]
    t0 = time.perf_counter()
    for v in vus:
        v.start()
    for v in vus:
        v.join(seconds + 90)
    elapsed = time.perf_counter() - t0
    stop.set()

    snap = collector.snapshot()
    # Without a token the authed endpoints return 401 by design.
    if not token:
        for r in snap.values():
            r.expected.add("401")
    total = sum(len(r.latencies) for r in snap.values())
    non_2xx = sum(sum(r.failures.values()) for r in snap.values())
    all_lat = [x for r in snap.values() for x in r.latencies]
    ordered = sorted(all_lat)
    ocr_sat = sum(1 for h in health
                  if h.get("workers", {}).get("ocr", {}).get("at_capacity"))

    def p(pct_: float) -> float:
        if not ordered:
            return 0.0
        k = max(0, min(len(ordered) - 1, int(round(pct_ / 100.0 * len(ordered) + 0.5)) - 1))
        return ordered[k]

    return {
        "users": users,
        "seconds": round(elapsed, 1),
        "requests": total,
        "rps": round(total / elapsed, 1) if elapsed else 0,
        "error_rate_pct": round(100.0 * non_2xx / total, 2) if total else 0.0,
        "p50": round(p(50), 1),
        "p95": round(p(95), 1),
        "p99": round(p(99), 1),
        "max": round(ordered[-1], 1) if ordered else 0.0,
        "ocr_saturation_samples": f"{ocr_sat}/{len(health)}",
        "per_endpoint": snap,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=True, help="API base, e.g. http://host/branch-visit/api/v1")
    p.add_argument("--stages", default="100,200", help="comma-separated concurrent-user counts")
    p.add_argument("--seconds", type=int, default=45, help="seconds per stage")
    p.add_argument("--timeout", type=float, default=30.0)
    p.add_argument("--photo-timeout", type=float, default=60.0)
    p.add_argument("--token", default=os.getenv("BV_TOKEN"), help="bearer token (enables the authed mix)")
    p.add_argument("--visit-id", help="demo visit id (required with --with-photos)")
    p.add_argument("--it-row-id", help="IT asset row id on that visit")
    p.add_argument("--with-photos", action="store_true", help="also drive the photo/OCR path")
    p.add_argument("--photo-ratio", type=float, default=0.15,
                   help="fraction of loop iterations that also upload a photo")
    p.add_argument("--think-ms", type=float, default=400.0,
                   help="per-request think time (0 = closed-loop saturation test)")
    p.add_argument("--out", help="write full JSON report to this path")
    args = p.parse_args()

    if args.with_photos and not (args.visit_id and args.it_row_id):
        sys.exit("--with-photos requires --visit-id and --it-row-id")

    stages = [int(x) for x in args.stages.split(",") if x.strip()]
    photo_bytes = make_image(0) if args.with_photos else None

    print(f"target   : {args.base}")
    print(f"stages   : {stages}  ({args.seconds}s each)")
    print(f"auth mix : {'ON (bearer token)' if args.token else 'OFF (public endpoints only)'}")
    print(f"photos   : {'ON ratio=%.2f' % args.photo_ratio if args.with_photos else 'OFF'}")
    print(f"think    : {args.think_ms}ms/request"
          f"{' (closed-loop saturation)' if args.think_ms <= 0 else ''}")
    print()

    report = []
    for users in stages:
        print(f">>> stage {users} concurrent users ...", flush=True)
        r = run_stage(users, args.seconds, args, args.token, Collector(), photo_bytes)
        report.append(r)
        print(f"    {r['requests']} reqs in {r['seconds']}s  rps={r['rps']}  "
              f"errors={r['error_rate_pct']}%")
        print(f"    p50={r['p50']}ms  p95={r['p95']}ms  p99={r['p99']}ms  max={r['max']}ms")
        print(f"    ocr_at_capacity={r['ocr_saturation_samples']}")
        for label, res in sorted(r["per_endpoint"].items()):
            bad = res.failures
            flag = f"  NON-2xx={bad}" if bad else ""
            print(f"      {label:<22} n={len(res.latencies):<5} "
                  f"p95={res.pct(95):>7.1f}ms p99={res.pct(99):>7.1f}ms{flag}")
        print()
        if r["error_rate_pct"] > 25:
            print(f"!! error rate {r['error_rate_pct']}% > 25% -- stopping the ramp")
            break
        time.sleep(5)

    print("=== summary ===")
    print(f"{'users':>7} {'reqs':>7} {'rps':>8} {'err%':>7} {'p50':>8} {'p95':>8} {'p99':>8} {'max':>8}")
    for r in report:
        print(f"{r['users']:>7} {r['requests']:>7} {r['rps']:>8} {r['error_rate_pct']:>7} "
              f"{r['p50']:>8} {r['p95']:>8} {r['p99']:>8} {r['max']:>8}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, default=str)
        print(f"\nfull report -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())