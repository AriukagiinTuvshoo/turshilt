"""Zero-dependency Prometheus text exposition metrics and 5xx spike webhook alerting."""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from collections import defaultdict, deque
from datetime import UTC, datetime
from urllib.parse import urlparse

from app.config import get_settings

PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"
LATENCY_BUCKETS: tuple[float, ...] = (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)
logger = logging.getLogger("guulingiinhan.metrics")


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


class MetricsRegistry:
    """Thread-safe in-process HTTP and SSE metrics registry rendered in Prometheus 0.0.4 format."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._started_at = time.monotonic()
        self._requests_total: dict[tuple[str, str, str], int] = defaultdict(int)
        self._duration_buckets: dict[tuple[str, str], list[int]] = {}
        self._duration_sum: dict[tuple[str, str], float] = defaultdict(float)
        self._duration_count: dict[tuple[str, str], int] = defaultdict(int)
        self._errors_5xx: dict[tuple[str, str], int] = defaultdict(int)
        self._rate_limited: dict[str, int] = defaultdict(int)

    def reset(self) -> None:
        """Clear accumulated counters and histograms (intended for deterministic tests)."""
        with self._lock:
            self._started_at = time.monotonic()
            self._requests_total.clear()
            self._duration_buckets.clear()
            self._duration_sum.clear()
            self._duration_count.clear()
            self._errors_5xx.clear()
            self._rate_limited.clear()

    def record_request(
        self,
        *,
        method: str,
        route: str,
        status_code: int,
        duration_seconds: float,
        error_code: str | None = None,
    ) -> None:
        status_class = f"{status_code // 100}xx"
        safe_duration = max(0.0, duration_seconds)
        with self._lock:
            self._requests_total[(method, route, status_class)] += 1
            hist_key = (method, route)
            counts = self._duration_buckets.get(hist_key)
            if counts is None:
                counts = [0] * (len(LATENCY_BUCKETS) + 1)
                self._duration_buckets[hist_key] = counts
            placed = False
            for idx, bound in enumerate(LATENCY_BUCKETS):
                if safe_duration <= bound:
                    counts[idx] += 1
                    placed = True
                    break
            if not placed:
                counts[-1] += 1
            self._duration_sum[hist_key] += safe_duration
            self._duration_count[hist_key] += 1

            if status_code >= 500:
                self._errors_5xx[(route, error_code or "INTERNAL_ERROR")] += 1
            elif status_code == 429:
                self._rate_limited[route] += 1

    def render(self, *, sse_connections: int = 0) -> str:
        lines: list[str] = []
        with self._lock:
            req_items = sorted(self._requests_total.items())
            hist_keys = sorted(self._duration_count.keys())
            hist_buckets = {k: list(self._duration_buckets[k]) for k in hist_keys}
            hist_sum = {k: self._duration_sum[k] for k in hist_keys}
            hist_count = {k: self._duration_count[k] for k in hist_keys}
            err_items = sorted(self._errors_5xx.items())
            rl_items = sorted(self._rate_limited.items())
            uptime = max(0.0, time.monotonic() - self._started_at)

        lines.append("# HELP guulin_http_requests_total Total HTTP requests handled by the API.")
        lines.append("# TYPE guulin_http_requests_total counter")
        for (method, route, status_class), count in req_items:
            m = _escape_label(method)
            r = _escape_label(route)
            s = _escape_label(status_class)
            lines.append(
                f'guulin_http_requests_total{{method="{m}",route="{r}",status_class="{s}"}} {count}'
            )

        lines.append(
            "# HELP guulin_http_request_duration_seconds HTTP request latency histogram in seconds."
        )
        lines.append("# TYPE guulin_http_request_duration_seconds histogram")
        for method, route in hist_keys:
            m = _escape_label(method)
            r = _escape_label(route)
            buckets = hist_buckets[(method, route)]
            cumulative = 0
            for idx, bound in enumerate(LATENCY_BUCKETS):
                cumulative += buckets[idx]
                lines.append(
                    f'guulin_http_request_duration_seconds_bucket{{method="{m}",route="{r}",le="{bound}"}} {cumulative}'
                )
            cumulative += buckets[-1]
            lines.append(
                f'guulin_http_request_duration_seconds_bucket{{method="{m}",route="{r}",le="+Inf"}} {cumulative}'
            )
            lines.append(
                f'guulin_http_request_duration_seconds_sum{{method="{m}",route="{r}"}} {hist_sum[(method, route)]:.6f}'
            )
            lines.append(
                f'guulin_http_request_duration_seconds_count{{method="{m}",route="{r}"}} {hist_count[(method, route)]}'
            )

        lines.append("# HELP guulin_http_errors_5xx_total Total HTTP 5xx server errors.")
        lines.append("# TYPE guulin_http_errors_5xx_total counter")
        for (route, err_code), count in err_items:
            lines.append(
                f'guulin_http_errors_5xx_total{{route="{_escape_label(route)}",error_code="{_escape_label(err_code)}"}} {count}'
            )

        lines.append("# HELP guulin_http_rate_limited_total Total HTTP 429 rate-limited responses.")
        lines.append("# TYPE guulin_http_rate_limited_total counter")
        for route, count in rl_items:
            lines.append(
                f'guulin_http_rate_limited_total{{route="{_escape_label(route)}"}} {count}'
            )

        lines.append(
            "# HELP guulin_chat_sse_active_connections Current active in-process chat SSE streams."
        )
        lines.append("# TYPE guulin_chat_sse_active_connections gauge")
        lines.append(f"guulin_chat_sse_active_connections {max(0, sse_connections)}")

        lines.append("# HELP guulin_process_uptime_seconds Process uptime in seconds.")
        lines.append("# TYPE guulin_process_uptime_seconds gauge")
        lines.append(f"guulin_process_uptime_seconds {uptime:.3f}")

        return "\n".join(lines) + "\n"


def _post_webhook(url: str, payload: dict[str, object]) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        logger.warning(
            "Invalid alert webhook URL scheme",
            extra={"event": "alert_dispatch_failed", "error_type": "ValueError"},
        )
        return
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3.0):
            logger.info("5xx spike alert dispatched", extra={"event": "alert_dispatched"})
    except Exception as error:  # noqa: BLE001 - alerting must never crash request handling
        logger.warning(
            "Alert webhook delivery failed",
            extra={"event": "alert_dispatch_failed", "error_type": type(error).__name__},
        )


class AlertDispatcher:
    """Sliding 60-second 5xx spike detector with cooldown webhook notifications."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._window: deque[float] = deque()
        self._last_alert_at: float | None = None

    def reset(self) -> None:
        with self._lock:
            self._window.clear()
            self._last_alert_at = None

    def record_5xx(
        self,
        *,
        route: str,
        error_code: str | None,
        request_id: str | None,
        now_monotonic: float | None = None,
    ) -> bool:
        settings = get_settings()
        webhook_url = settings.alert_webhook_url
        if not webhook_url:
            return False

        now = time.monotonic() if now_monotonic is None else now_monotonic
        cutoff = now - 60.0

        with self._lock:
            self._window.append(now)
            while self._window and self._window[0] < cutoff:
                self._window.popleft()
            if len(self._window) < settings.alert_5xx_threshold:
                return False
            if (
                self._last_alert_at is not None
                and now - self._last_alert_at < settings.alert_cooldown_seconds
            ):
                return False
            self._last_alert_at = now
            errors_in_window = len(self._window)

        payload: dict[str, object] = {
            "service": "guulingiinhan-api",
            "environment": settings.app_env,
            "event": "http_5xx_spike",
            "errors_in_window": errors_in_window,
            "window_seconds": 60,
            "latest_route": route,
            "latest_error_code": error_code or "INTERNAL_ERROR",
            "latest_request_id": request_id,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        thread = threading.Thread(
            target=_post_webhook,
            args=(webhook_url, payload),
            name="guulin-alert-dispatch",
            daemon=True,
        )
        thread.start()
        return True


metrics_registry = MetricsRegistry()
alert_dispatcher = AlertDispatcher()
