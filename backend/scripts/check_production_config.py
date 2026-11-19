"""Production pre-flight configuration, database, and storage readiness checker.

Usage:
    uv run python scripts/check_production_config.py --env-file .env.production
    uv run python scripts/check_production_config.py --env-file .env.production --check-db --check-storage
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import text

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import Settings
from app.db import make_engine
from app.storage import LocalObjectStorage, S3ObjectStorage


def _build_settings(env_file: str | None) -> Settings:
    if env_file:
        path = Path(env_file)
        if not path.is_file():
            raise FileNotFoundError(f"Env file not found: {env_file}")
        return Settings(_env_file=str(path), app_env="production")  # type: ignore[call-arg]
    return Settings(app_env="production")


def _safe_validation_messages(exc: ValidationError) -> list[str]:
    messages: list[str] = []
    for err in exc.errors(include_url=False, include_context=False, include_input=False):
        loc = ".".join(str(part) for part in err.get("loc", ()))
        msg = str(err.get("msg", "Validation failed"))
        messages.append(f"{loc}: {msg}" if loc else msg)
    return messages


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate Guulingiinhan production environment settings without leaking secrets."
    )
    parser.add_argument(
        "--env-file",
        default=None,
        help="Optional path to .env.production file to inspect.",
    )
    parser.add_argument(
        "--check-db",
        action="store_true",
        help="Verify live PostgreSQL connection with SELECT 1.",
    )
    parser.add_argument(
        "--check-storage",
        action="store_true",
        help="Verify live S3 / Cloudflare R2 bucket reachability.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON check results.",
    )
    args = parser.parse_args(argv)

    checks: list[dict[str, str | bool]] = []
    settings: Settings | None = None

    try:
        settings = _build_settings(args.env_file)
        checks.append({"check": "settings", "ok": True, "detail": "All production config rules passed"})
        if settings.google_oidc_enabled:
            checks.append({"check": "google_oidc", "ok": True, "detail": "Enabled and valid"})
        else:
            checks.append({"check": "google_oidc", "ok": True, "detail": "Disabled (optional)"})
    except FileNotFoundError as exc:
        checks.append({"check": "settings", "ok": False, "detail": str(exc)})
    except ValidationError as exc:
        for msg in _safe_validation_messages(exc):
            checks.append({"check": "settings", "ok": False, "detail": msg})

    if args.check_db and settings is not None:
        engine = None
        try:
            engine = make_engine(settings.database_url)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            checks.append({"check": "database", "ok": True, "detail": "SELECT 1 succeeded"})
        except Exception as exc:  # noqa: BLE001 - safe summarized error name without DSN credentials
            checks.append(
                {"check": "database", "ok": False, "detail": f"Database check failed ({type(exc).__name__})"}
            )
        finally:
            if engine is not None:
                engine.dispose()

    if args.check_storage and settings is not None:
        try:
            if settings.storage_provider.lower() == "s3":
                storage = S3ObjectStorage(
                    settings.storage_endpoint or "",
                    settings.storage_bucket or "",
                    settings.storage_region,
                    settings.storage_access_key or "",
                    settings.storage_secret_key or "",
                )
            else:
                storage = LocalObjectStorage(settings.storage_local_path)
            storage.exists("__healthcheck__")
            checks.append(
                {
                    "check": "storage",
                    "ok": True,
                    "detail": f"Storage provider '{settings.storage_provider}' reachable",
                }
            )
        except Exception as exc:  # noqa: BLE001 - safe summarized error name without keys
            checks.append(
                {"check": "storage", "ok": False, "detail": f"Storage check failed ({type(exc).__name__})"}
            )

    all_ok = all(bool(item["ok"]) for item in checks)
    if args.json:
        print(json.dumps({"ok": all_ok, "checks": checks}, ensure_ascii=False))
    else:
        for item in checks:
            mark = "PASS" if item["ok"] else "FAIL"
            print(f"[{mark}] {item['check']}: {item['detail']}")

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
