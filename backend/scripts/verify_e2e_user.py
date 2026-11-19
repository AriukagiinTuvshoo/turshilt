"""CLI helper for E2E tests: marks a newly registered test email as verified."""

import sys
from datetime import UTC, datetime

from sqlalchemy import select

from app.db import SessionLocal
from app.identity import normalize_email
from app.models import LoginIdentity, User


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/verify_e2e_user.py <email>", file=sys.stderr)
        return 1
    email = normalize_email(sys.argv[1])
    now = datetime.now(UTC)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            print(f"User not found: {email}", file=sys.stderr)
            return 2
        user.email_verified_at = now
        identity = db.scalar(
            select(LoginIdentity).where(
                LoginIdentity.user_id == user.id,
                LoginIdentity.provider == "email",
            )
        )
        if identity is not None:
            identity.verified_at = now
        db.commit()
    print(f"Verified E2E user: {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
