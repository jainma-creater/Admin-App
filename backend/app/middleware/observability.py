"""Observability: X-Request-Id correlation + dependency-free Prometheus-style
metrics for the single-node production deployment.

No external packages: the /metrics payload is rendered here in Prometheus text
format so any scrape target works out of the box. Counters are in-process
(per uvicorn worker); the deployment guide documents the single-worker default
that makes these comparable across restarts.
"""

import time
import uuid
from collections import defaultdict
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware

_START = time.time()
_lock = Lock()
_reqs: dict[tuple[str, str], int] = defaultdict(int)  # (method, label) -> count
_status: dict[int, int] = defaultdict(int)            # status -> count
_latency_sum: dict[str, float] = defaultdict(float)   # label -> total seconds
_latency_n: dict[str, int] = defaultdict(int)         # label -> samples


def _label(path: str) -> str:
    """Coarse URL label: collapse UUIDs and numeric ids to keep cardinality low."""
    parts = []
    for seg in path.split("/"):
        if not seg:
            continue
        if seg.isdigit() or (len(seg) >= 24 and seg.replace("-", "").isalnum()):
            parts.append(":id")
        else:
            parts.append(seg)
    return "/" + "/".join(parts)


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        start = time.perf_counter()
        response = None
        try:
            response = await call_next(request)
            return response
        finally:
            dur = time.perf_counter() - start
            code = response.status_code if response is not None else 500
            label = _label(request.url.path)
            with _lock:
                _reqs[(request.method, label)] += 1
                _status[code] += 1
                _latency_sum[label] += dur
                _latency_n[label] += 1
            if response is not None:
                response.headers.setdefault("X-Request-Id", request_id)


def render_metrics() -> str:
    lines: list[str] = []

    def c(name: str, help_: str) -> None:
        lines.append(f"# HELP {name} {help_}")
        lines.append(f"# TYPE {name} counter")

    def g(name: str, help_: str) -> None:
        lines.append(f"# HELP {name} {help_}")
        lines.append(f"# TYPE {name} gauge")

    c("bv_http_requests_total", "Total HTTP requests by method and endpoint label")
    with _lock:
        items = sorted(_reqs.items())
        for (method, label), n in items:
            lines.append(
                f'bv_http_requests_total{{method="{method}",path="{label}"}} {n}'
            )

        c("bv_http_responses_total", "Total HTTP responses by status code")
        for code in sorted(_status):
            lines.append(f'bv_http_responses_total{{status="{code}"}} {_status[code]}')

        g("bv_http_latency_seconds_sum", "Sum of request latency by endpoint label")
        for label in sorted(_latency_sum):
            lines.append(f'bv_http_latency_seconds_sum{{path="{label}"}} {_latency_sum[label]:.6f}')
        g("bv_http_latency_seconds_count", "Number of latency samples by endpoint label")
        for label in sorted(_latency_n):
            lines.append(f'bv_http_latency_seconds_count{{path="{label}"}} {_latency_n[label]}')

        g("bv_uptime_seconds", "Seconds since the process started")
        lines.append(f"bv_uptime_seconds {int(time.time() - _START)}")

    return "\n".join(lines) + "\n"