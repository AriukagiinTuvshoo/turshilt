"""Scheduled maintenance service: 30-day trash pruning, expired auth cleanup, stale photos."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Biography,
    EmailVerificationToken,
    FamilyPerson,
    FamilyTrashRecord,
    LifeEvent,
    LoginThrottle,
    Marriage,
    MemoryPersonTag,
    ParentChildRelationship,
    PasswordResetToken,
    Person,
    PersonLineageAssignment,
    PhoneOtpChallenge,
    Photo,
    PhotoPersonTag,
    UserPersonLink,
    UserSession,
)
from app.storage import ObjectStorage

logger = logging.getLogger("guulingiinhan.maintenance")


@dataclass
class MaintenanceReport:
    """Summary counts produced by one maintenance pass."""

    dry_run: bool
    retention_days: int
    trash_records_pruned: int = 0
    orphan_persons_pruned: int = 0
    expired_sessions_pruned: int = 0
    expired_email_tokens_pruned: int = 0
    expired_password_tokens_pruned: int = 0
    expired_otp_challenges_pruned: int = 0
    expired_login_throttles_pruned: int = 0
    stale_photos_cleaned: int = 0

    def to_dict(self) -> dict[str, int | bool]:
        return asdict(self)


def _find_orphan_person_ids(
    db: Session,
    candidate_ids: set[UUID],
    *,
    excluding_trash_ids: set[UUID] | None = None,
) -> list[UUID]:
    """Return candidate person IDs detached from all active families, users, and trash records."""
    if not candidate_ids:
        return []

    in_family = set(
        db.scalars(
            select(FamilyPerson.person_id).where(FamilyPerson.person_id.in_(candidate_ids))
        ).all()
    )
    linked_user = set(
        db.scalars(
            select(UserPersonLink.person_id).where(UserPersonLink.person_id.in_(candidate_ids))
        ).all()
    )
    trash_stmt = select(FamilyTrashRecord.person_id).where(
        FamilyTrashRecord.person_id.in_(candidate_ids)
    )
    if excluding_trash_ids:
        trash_stmt = trash_stmt.where(FamilyTrashRecord.id.not_in(excluding_trash_ids))
    still_in_trash = set(db.scalars(trash_stmt).all())

    return sorted(candidate_ids - in_family - linked_user - still_in_trash, key=str)


def _purge_orphan_persons(db: Session, orphan_ids: list[UUID]) -> int:
    """Permanently remove detached Person records and their residual dependent rows."""
    if not orphan_ids:
        return 0

    db.execute(
        delete(ParentChildRelationship).where(
            or_(
                ParentChildRelationship.parent_id.in_(orphan_ids),
                ParentChildRelationship.child_id.in_(orphan_ids),
            )
        )
    )
    db.execute(
        delete(Marriage).where(
            or_(
                Marriage.person_1_id.in_(orphan_ids),
                Marriage.person_2_id.in_(orphan_ids),
            )
        )
    )
    for model in (
        Biography,
        LifeEvent,
        MemoryPersonTag,
        PhotoPersonTag,
        PersonLineageAssignment,
    ):
        db.execute(delete(model).where(model.person_id.in_(orphan_ids)))

    result = db.execute(delete(Person).where(Person.id.in_(orphan_ids)))
    return int(result.rowcount or 0)


def prune_expired_trash(
    db: Session,
    *,
    retention_days: int = 30,
    family_id: UUID | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
) -> tuple[int, int]:
    """Delete trash records older than retention_days and clean orphaned Person rows.

    Returns (trash_records_pruned, orphan_persons_pruned).
    """
    cutoff = (now or datetime.now(UTC)) - timedelta(days=retention_days)
    filters = [FamilyTrashRecord.deleted_at < cutoff]
    if family_id is not None:
        filters.append(FamilyTrashRecord.family_id == family_id)

    expired_rows = db.execute(
        select(FamilyTrashRecord.id, FamilyTrashRecord.person_id).where(*filters)
    ).all()
    if not expired_rows:
        return 0, 0

    expired_ids = {row[0] for row in expired_rows}
    candidate_person_ids = {row[1] for row in expired_rows}

    if dry_run:
        orphan_ids = _find_orphan_person_ids(
            db, candidate_person_ids, excluding_trash_ids=expired_ids
        )
        return len(expired_ids), len(orphan_ids)

    db.execute(delete(FamilyTrashRecord).where(FamilyTrashRecord.id.in_(expired_ids)))
    db.flush()
    orphan_ids = _find_orphan_person_ids(db, candidate_person_ids)
    orphans_deleted = _purge_orphan_persons(db, orphan_ids)
    return len(expired_ids), orphans_deleted


def _prune_model_before(
    db: Session,
    model,
    cutoff: datetime,
    *,
    dry_run: bool,
) -> int:
    if dry_run:
        return int(
            db.scalar(select(func.count()).select_from(model).where(model.expires_at < cutoff))
            or 0
        )
    result = db.execute(delete(model).where(model.expires_at < cutoff))
    return int(result.rowcount or 0)


def prune_expired_auth_artifacts(
    db: Session,
    *,
    dry_run: bool = False,
    now: datetime | None = None,
) -> dict[str, int]:
    """Remove expired browser sessions, verification/reset tokens, OTP records, and throttles."""
    ts = now or datetime.now(UTC)
    otp_cutoff = ts - timedelta(hours=24)
    throttle_cutoff = ts - timedelta(days=7)

    if dry_run:
        throttles_pruned = int(
            db.scalar(
                select(func.count())
                .select_from(LoginThrottle)
                .where(LoginThrottle.window_started < throttle_cutoff)
            )
            or 0
        )
    else:
        throttles_pruned = int(
            db.execute(
                delete(LoginThrottle).where(LoginThrottle.window_started < throttle_cutoff)
            ).rowcount
            or 0
        )

    return {
        "expired_sessions_pruned": _prune_model_before(db, UserSession, ts, dry_run=dry_run),
        "expired_email_tokens_pruned": _prune_model_before(
            db, EmailVerificationToken, ts, dry_run=dry_run
        ),
        "expired_password_tokens_pruned": _prune_model_before(
            db, PasswordResetToken, ts, dry_run=dry_run
        ),
        "expired_otp_challenges_pruned": _prune_model_before(
            db, PhoneOtpChallenge, otp_cutoff, dry_run=dry_run
        ),
        "expired_login_throttles_pruned": throttles_pruned,
    }


def cleanup_stale_photos(
    db: Session,
    storage: ObjectStorage,
    *,
    limit: int = 100,
    dry_run: bool = False,
    now: datetime | None = None,
) -> int:
    """Retry deletion for pending tombstones and abandoned uploading photos across families."""
    max_attempts = get_settings().photo_cleanup_max_attempts
    cutoff = (now or datetime.now(UTC)) - timedelta(minutes=15)

    stmt = (
        select(Photo)
        .where(
            or_(
                Photo.storage_status == "deletion_pending",
                (Photo.storage_status == "uploading") & (Photo.created_at < cutoff),
            ),
            Photo.cleanup_attempts < max_attempts,
        )
        .order_by(Photo.created_at)
        .limit(limit)
    )
    stale_photos = list(db.scalars(stmt).all())
    if dry_run:
        return len(stale_photos)

    cleaned = 0
    for photo in stale_photos:
        photo.storage_status = "deletion_pending"
        photo.cleanup_attempts += 1
        keys = [k for k in (photo.thumbnail_object_key, photo.object_key) if k]
        try:
            for key in keys:
                storage.delete(key)
        except Exception as error:  # noqa: BLE001 - isolate individual storage failures
            logger.warning(
                "Scheduled photo cleanup failed",
                extra={
                    "event": "photo_cleanup_failed",
                    "operation": "delete",
                    "photo_id": str(photo.id),
                    "family_id": str(photo.family_id),
                    "attempt": photo.cleanup_attempts,
                    "error_type": type(error).__name__,
                },
            )
            continue
        db.delete(photo)
        cleaned += 1

    return cleaned


def run_maintenance(
    db: Session,
    storage: ObjectStorage | None = None,
    *,
    retention_days: int | None = None,
    dry_run: bool = False,
    include_photos: bool = True,
    now: datetime | None = None,
) -> MaintenanceReport:
    """Run one complete maintenance cycle across trash, auth tokens, and stale photos."""
    days = retention_days if retention_days is not None else get_settings().trash_retention_days
    trash_pruned, orphans_pruned = prune_expired_trash(
        db, retention_days=days, dry_run=dry_run, now=now
    )
    auth_counts = prune_expired_auth_artifacts(db, dry_run=dry_run, now=now)
    photos_cleaned = (
        cleanup_stale_photos(db, storage, dry_run=dry_run, now=now)
        if include_photos and storage is not None
        else 0
    )

    if dry_run:
        db.rollback()
    else:
        db.commit()

    report = MaintenanceReport(
        dry_run=dry_run,
        retention_days=days,
        trash_records_pruned=trash_pruned,
        orphan_persons_pruned=orphans_pruned,
        expired_sessions_pruned=auth_counts["expired_sessions_pruned"],
        expired_email_tokens_pruned=auth_counts["expired_email_tokens_pruned"],
        expired_password_tokens_pruned=auth_counts["expired_password_tokens_pruned"],
        expired_otp_challenges_pruned=auth_counts["expired_otp_challenges_pruned"],
        expired_login_throttles_pruned=auth_counts["expired_login_throttles_pruned"],
        stale_photos_cleaned=photos_cleaned,
    )
    logger.info(
        "Maintenance run completed",
        extra={"event": "maintenance_completed", **report.to_dict()},
    )
    return report
