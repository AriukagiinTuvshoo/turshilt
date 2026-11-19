"""Tests for Prometheus /metrics endpoint and 5xx spike webhook alerting."""

from types import SimpleNamespace

from app.metrics import _post_webhook, alert_dispatcher, metrics_registry


def test_metrics_endpoint_renders_prometheus_counters_and_histograms(client):
    metrics_registry.reset()

    ok = client.get("/health")
    assert ok.status_code == 200
    not_found = client.get("/api/v1/does-not-exist-for-metrics")
    assert not_found.status_code == 404

    res = client.get("/metrics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/plain; version=0.0.4")
    assert res.headers["cache-control"] == "no-store"

    text = res.text
    assert 'guulin_http_requests_total{method="GET",route="/health",status_class="2xx"}' in text
    assert 'guulin_http_requests_total{method="GET",route="unmatched",status_class="4xx"}' in text
    assert "guulin_http_request_duration_seconds_bucket" in text
    assert "guulin_chat_sse_active_connections 0" in text
    assert "guulin_process_uptime_seconds" in text


def test_metrics_bearer_token_and_production_fail_closed(client, monkeypatch):
    def make_settings(*, app_env: str, metrics_enabled: bool, token: str | None):
        return SimpleNamespace(
            app_env=app_env,
            metrics_enabled=metrics_enabled,
            metrics_bearer_token=token,
            alert_webhook_url=None,
        )

    # Bearer token required when configured
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: make_settings(app_env="development", metrics_enabled=True, token="secret-prom-token"),
    )
    assert client.get("/metrics").status_code == 401
    assert (
        client.get("/metrics", headers={"Authorization": "Bearer wrong-token"}).status_code == 401
    )
    authorized = client.get("/metrics", headers={"Authorization": "Bearer secret-prom-token"})
    assert authorized.status_code == 200

    # Production without bearer token fails closed (404)
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: make_settings(app_env="production", metrics_enabled=True, token=None),
    )
    assert client.get("/metrics").status_code == 404

    # Disabled metrics returns 404
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: make_settings(app_env="development", metrics_enabled=False, token=None),
    )
    assert client.get("/metrics").status_code == 404


def test_alert_dispatcher_triggers_once_at_threshold_with_cooldown(monkeypatch):
    alert_dispatcher.reset()
    sent: list[tuple[str, dict[str, object]]] = []

    class ImmediateThread:
        def __init__(self, *, target, args, **_kwargs):
            self._target = target
            self._args = args

        def start(self):
            self._target(*self._args)

    monkeypatch.setattr(
        "app.metrics.get_settings",
        lambda: SimpleNamespace(
            app_env="test",
            alert_webhook_url="https://alerts.example.invalid/webhook",
            alert_5xx_threshold=3,
            alert_cooldown_seconds=300,
        ),
    )
    monkeypatch.setattr("app.metrics.threading.Thread", ImmediateThread)
    monkeypatch.setattr(
        "app.metrics._post_webhook",
        lambda url, payload: sent.append((url, payload)),
    )

    assert alert_dispatcher.record_5xx(
        route="/ready", error_code="DATABASE_UNAVAILABLE", request_id="r1", now_monotonic=100.0
    ) is False
    assert alert_dispatcher.record_5xx(
        route="/ready", error_code="DATABASE_UNAVAILABLE", request_id="r2", now_monotonic=101.0
    ) is False
    # 3rd error in 60s window fires once
    assert alert_dispatcher.record_5xx(
        route="/ready", error_code="DATABASE_UNAVAILABLE", request_id="r3", now_monotonic=102.0
    ) is True
    assert len(sent) == 1
    assert sent[0][0] == "https://alerts.example.invalid/webhook"
    assert sent[0][1]["errors_in_window"] == 3
    assert sent[0][1]["event"] == "http_5xx_spike"
    assert sent[0][1]["latest_request_id"] == "r3"

    # Cooldown suppresses 4th error within 300s
    assert alert_dispatcher.record_5xx(
        route="/ready", error_code="DATABASE_UNAVAILABLE", request_id="r4", now_monotonic=110.0
    ) is False
    assert len(sent) == 1

    # After cooldown expires with enough recent errors, fires again
    assert alert_dispatcher.record_5xx(
        route="/ready", error_code="DATABASE_UNAVAILABLE", request_id="r5", now_monotonic=420.0
    ) is False
    assert alert_dispatcher.record_5xx(
        route="/ready", error_code="DATABASE_UNAVAILABLE", request_id="r6", now_monotonic=421.0
    ) is False
    assert alert_dispatcher.record_5xx(
        route="/ready", error_code="DATABASE_UNAVAILABLE", request_id="r7", now_monotonic=422.0
    ) is True
    assert len(sent) == 2


def test_post_webhook_ignores_network_errors_safely(monkeypatch):
    def fail_urlopen(*_args, **_kwargs):
        raise OSError("network unreachable")

    monkeypatch.setattr("app.metrics.urllib.request.urlopen", fail_urlopen)
    # Should never raise
    _post_webhook("https://alerts.example.invalid/hook", {"event": "http_5xx_spike"})
    _post_webhook("file:///etc/passwd", {"event": "http_5xx_spike"})
