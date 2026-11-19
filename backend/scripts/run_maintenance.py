"""CLI / cron runner for scheduled database & object storage maintenance.

Usage:
    uv run python scripts/run_maintenance.py
    uv run python scripts/run_maintenance.py --dry-run --json
    uv run python scripts/run_maintenance.py --trash-days 30 --skip-photos
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings
from app.db import SessionLocal
from app.maintenance import run_maintenance
from app.observability import configure_logging
from app.storage import get_storage


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run Guulingiinhan maintenance: 30-day trash prune, expired auth tokens, stale photos."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count candidates without deleting or modifying any records.",
    )
    parser.add_argument(
        "--trash-days",
        type=int,
        default=None,
        help="Override TRASH_RETENTION_DAYS (1..365).",
    )
    parser.add_argument(
        "--skip-photos",
        action="store_true",
        help="Skip stale/deletion_pending object storage cleanup.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON summary.",
    )
    args = parser.parse_args(argv)

    if args.trash_days is not None and not 1 <= args.trash_days <= 365:
        print("Error: --trash-days must be between 1 and 365.", file=sys.stderr)
        return 2

    settings = get_settings()
    if not args.json:
        configure_logging(settings.log_level, settings.app_env)

    storage = None if args.skip_photos else get_storage()
    with SessionLocal() as db:
        report = run_maintenance(
            db,
            storage,
            retention_days=args.trash_days,
            dry_run=args.dry_run,
            include_photos=not args.skip_photos,
        )

    payload = report.to_dict()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False))
    else:
        mode = "DRY-RUN" if report.dry_run else "APPLIED"
        print(
            f"[{mode}] Trash pruned: {report.trash_records_pruned} "
            f"(orphan people: {report.orphan_persons_pruned}), "
            f"sessions: {report.expired_sessions_pruned}, "
            f"email tokens: {report.expired_email_tokens_pruned}, "
            f"reset tokens: {report.expired_password_tokens_pruned}, "
            f"OTP challenges: {report.expired_otp_challenges_pruned}, "
            f"stale photos: {report.stale_photos_cleaned}."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
