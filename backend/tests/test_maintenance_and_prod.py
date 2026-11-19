"""Tests for /ready, production config validation, 30-day trash prune, and maintenance CLI."""

import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from conftest import register_verified
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings
from app.main import app
from app.maintenance import (
    cleanup_stale_photos,
    prune_expired_auth_artifacts,
    prune_expired_trash,
    run_maintenance,
)
from app.models import (
    EmailVerificationToken,
    Family,
    FamilyPerson,
    FamilyTrashRecord,
    LoginThrottle,
    PasswordResetToken,
    Person,
    PhoneOtpChallenge,
    Photo,
    User,
    UserPersonLink,
    UserSession,
)
from app.storage import LocalObjectStorage
from scripts.check_production_config import main as check_prod_main


def test_ready_alias_ok_and_failure_503(monkeypatch):
    ok_resp = TestClient(app).get("/ready")
    assert ok_resp.status_code == 200
    assert ok_resp.json()["database"] == "ok"

    def unavailable():
        raise SQLAlchemyError("postgresql://secret-user:secret-pass@db-internal/app")

    monkeypatch.setattr("app.main.engine.connect", unavailable)
    fail_resp = TestClient(app).get("/ready")
    assert fail_resp.status_code == 503
    assert fail_resp.json()["error_code"] == "DATABASE_UNAVAILABLE"
    assert "secret-pass" not in fail_resp.text


def test_config_validates_sms_even_with_google_oidc_and_trash_retention():
    with pytest.raises(ValidationError):
        Settings(
            google_oidc_enabled=True,
            google_oidc_client_id="cid",
            google_oidc_client_secret="csecret",
            google_oidc_redirect_uri="http://localhost:8000/api/v1/auth/google/callback",
            sms_provider="invalid-sms",
        )
    with pytest.raises(ValidationError):
        Settings(trash_retention_days=0)
    with pytest.raises(ValidationError):
        Settings(trash_retention_days=366)

    valid = Settings(trash_retention_days=45)
    assert valid.trash_retention_days == 45


def test_check_production_config_script_never_leaks_secrets(tmp_path, capsys):
    env_file = tmp_path / ".env.bad"
    secret_marker = "SUPER_SECRET_SHOULD_NEVER_PRINT_12345"
    env_file.write_text(
        "\n".join(
            [
                "DATABASE_URL=sqlite:///./local.db",
                f"OTP_HASH_SECRET={secret_marker}",
                "SMS_PROVIDER=fake",
                "EMAIL_PROVIDER=fake",
            ]
        ),
        encoding="utf-8",
    )

    rc = check_prod_main(["--env-file", str(env_file), "--json"])
    assert rc == 1
    captured = capsys.readouterr().out
    assert secret_marker not in captured
    data = json.loads(captured)
    assert data["ok"] is False
    assert any(c["ok"] is False for c in data["checks"])

    good_env = tmp_path / ".env.good"
    good_env.write_text(
        "\n".join(
            [
                "DATABASE_URL=postgresql+psycopg://user:SuperPassSecret@db:5432/guulin",
                "CORS_ORIGINS=https://guulingiinhan.mn",
                "OTP_HASH_SECRET=" + ("a" * 40),
                "SMS_PROVIDER=twilio",
                "TWILIO_ACCOUNT_SID=AC" + ("1" * 32),
                "TWILIO_AUTH_TOKEN=tok" + ("2" * 32),
                "TWILIO_FROM_NUMBER=+12025550100",
                "EMAIL_PROVIDER=smtp",
                "EMAIL_FROM=no-reply@guulingiinhan.mn",
                "EMAIL_PUBLIC_BASE_URL=https://guulingiinhan.mn",
                "EMAIL_SMTP_HOST=smtp.example.net",
                "EMAIL_SMTP_USERNAME=smtp-user",
                "EMAIL_SMTP_PASSWORD=smtp-secret-password",
                "EMAIL_SMTP_STARTTLS=true",
                "STORAGE_PROVIDER=s3",
                "STORAGE_ENDPOINT=https://acct.r2.cloudflarestorage.com",
                "STORAGE_BUCKET=guulin-private",
                "STORAGE_REGION=auto",
                "STORAGE_ACCESS_KEY=ak",
                "STORAGE_SECRET_KEY=sk",
                "TRASH_RETENTION_DAYS=30",
            ]
        ),
        encoding="utf-8",
    )
    rc_ok = check_prod_main(["--env-file", str(good_env), "--json"])
    assert rc_ok == 0
    ok_out = capsys.readouterr().out
    assert "SuperPassSecret" not in ok_out
    assert "smtp-secret-password" not in ok_out
    assert json.loads(ok_out)["ok"] is True


def test_prune_expired_trash_and_orphan_cleanup(database):
    now = datetime(2026, 11, 19, 12, 0, 0, tzinfo=UTC)
    with database() as db:
        user = User(id=uuid4(), email="prune@example.com", display_name="Owner")
        db.add(user)
        db.flush()

        family = Family(id=uuid4(), name="Цэвэрлэгээний ураг", created_by=user.id)
        db.add(family)
        db.flush()

        p_old_orphan = Person(id=uuid4(), first_name="Хуучин", last_name="Удам", created_by=user.id)
        p_old_attached = Person(id=uuid4(), first_name="Идэвхтэй", last_name="Удам", created_by=user.id)
        p_old_linked = Person(id=uuid4(), first_name="Холбоотой", last_name="Удам", created_by=user.id)
        p_recent = Person(id=uuid4(), first_name="Шинэ", last_name="Удам", created_by=user.id)
        db.add_all([p_old_orphan, p_old_attached, p_old_linked, p_recent])
        db.flush()

        # p_old_attached is still in FamilyPerson; p_old_linked is linked to user
        db.add(FamilyPerson(family_id=family.id, person_id=p_old_attached.id, added_by=user.id))
        db.add(UserPersonLink(user_id=user.id, person_id=p_old_linked.id, linked_by=user.id))

        # Trash records: 3 expired (35 days old), 1 recent (5 days old)
        t_orphan = FamilyTrashRecord(
            id=uuid4(),
            family_id=family.id,
            person_id=p_old_orphan.id,
            person_name="Удам Хуучин",
            deleted_by=user.id,
            deleted_at=now - timedelta(days=35),
        )
        t_attached = FamilyTrashRecord(
            id=uuid4(),
            family_id=family.id,
            person_id=p_old_attached.id,
            person_name="Удам Идэвхтэй",
            deleted_by=user.id,
            deleted_at=now - timedelta(days=35),
        )
        t_linked = FamilyTrashRecord(
            id=uuid4(),
            family_id=family.id,
            person_id=p_old_linked.id,
            person_name="Удам Холбоотой",
            deleted_by=user.id,
            deleted_at=now - timedelta(days=35),
        )
        t_recent = FamilyTrashRecord(
            id=uuid4(),
            family_id=family.id,
            person_id=p_recent.id,
            person_name="Удам Шинэ",
            deleted_by=user.id,
            deleted_at=now - timedelta(days=5),
        )
        db.add_all([t_orphan, t_attached, t_linked, t_recent])
        db.commit()

        # Dry run: counts 3 expired trash rows and 1 orphan person, modifies nothing
        trash_dry, orphan_dry = prune_expired_trash(db, retention_days=30, dry_run=True, now=now)
        assert trash_dry == 3
        assert orphan_dry == 1
        assert db.get(FamilyTrashRecord, t_orphan.id) is not None
        assert db.get(Person, p_old_orphan.id) is not None

        # Actual prune
        trash_del, orphan_del = prune_expired_trash(db, retention_days=30, dry_run=False, now=now)
        db.commit()
        assert trash_del == 3
        assert orphan_del == 1

        # Expired trash rows gone, recent remains
        assert db.get(FamilyTrashRecord, t_orphan.id) is None
        assert db.get(FamilyTrashRecord, t_recent.id) is not None

        # Only truly detached orphan Person was permanently deleted
        assert db.get(Person, p_old_orphan.id) is None
        assert db.get(Person, p_old_attached.id) is not None
        assert db.get(Person, p_old_linked.id) is not None
        assert db.get(Person, p_recent.id) is not None


def test_auth_artifacts_and_stale_photos_maintenance(database, tmp_path):
    now = datetime(2026, 11, 19, 12, 0, 0, tzinfo=UTC)
    storage = LocalObjectStorage(tmp_path / "uploads")

    with database() as db:
        user = User(id=uuid4(), email="maint@example.com", display_name="Maint")
        db.add(user)
        db.flush()
        family = Family(id=uuid4(), name="Зургийн ураг", created_by=user.id)
        db.add(family)
        db.flush()

        # Auth artifacts: 1 expired + 1 active for each type
        s_exp = UserSession(
            user_id=user.id, token_hash="s-exp", expires_at=now - timedelta(minutes=1)
        )
        s_act = UserSession(
            user_id=user.id, token_hash="s-act", expires_at=now + timedelta(days=1)
        )
        ev_exp = EmailVerificationToken(
            user_id=user.id, token_hash="ev-exp", expires_at=now - timedelta(hours=2)
        )
        ev_act = EmailVerificationToken(
            user_id=user.id, token_hash="ev-act", expires_at=now + timedelta(hours=2)
        )
        pr_exp = PasswordResetToken(
            user_id=user.id, token_hash="pr-exp", expires_at=now - timedelta(minutes=5)
        )
        pr_act = PasswordResetToken(
            user_id=user.id, token_hash="pr-act", expires_at=now + timedelta(minutes=30)
        )
        otp_old = PhoneOtpChallenge(
            phone_e164="+97699110001",
            purpose="phone_login",
            code_hash="otp1",
            status="expired",
            expires_at=now - timedelta(hours=25),
        )
        otp_recent = PhoneOtpChallenge(
            phone_e164="+97699110002",
            purpose="phone_login",
            code_hash="otp2",
            status="pending",
            expires_at=now + timedelta(minutes=5),
        )
        lt_old = LoginThrottle(
            key_hash="lt-old",
            window_started=now - timedelta(days=8),
            attempts=3,
        )
        lt_recent = LoginThrottle(
            key_hash="lt-act",
            window_started=now - timedelta(minutes=10),
            attempts=1,
        )
        db.add_all(
            [s_exp, s_act, ev_exp, ev_act, pr_exp, pr_act, otp_old, otp_recent, lt_old, lt_recent]
        )

        # Photos: 1 deletion_pending, 1 abandoned uploading, 1 ready
        k_del = "families/test/del/original"
        k_del_thumb = "families/test/del/thumb.jpg"
        k_up = "families/test/up/original"
        k_ready = "families/test/ready/original"
        for k in (k_del, k_del_thumb, k_up, k_ready):
            storage.put(k, b"img-bytes", "image/jpeg")

        ph_del = Photo(
            family_id=family.id,
            object_key=k_del,
            thumbnail_object_key=k_del_thumb,
            storage_status="deletion_pending",
            uploaded_by=user.id,
            created_at=now - timedelta(minutes=2),
        )
        ph_up = Photo(
            family_id=family.id,
            object_key=k_up,
            thumbnail_object_key=None,
            storage_status="uploading",
            uploaded_by=user.id,
            created_at=now - timedelta(minutes=30),
        )
        ph_ready = Photo(
            family_id=family.id,
            object_key=k_ready,
            thumbnail_object_key=None,
            storage_status="ready",
            uploaded_by=user.id,
            created_at=now - timedelta(days=10),
        )
        db.add_all([ph_del, ph_up, ph_ready])
        db.commit()

        report = run_maintenance(db, storage, retention_days=30, dry_run=False, now=now)
        assert report.expired_sessions_pruned == 1
        assert report.expired_email_tokens_pruned == 1
        assert report.expired_password_tokens_pruned == 1
        assert report.expired_otp_challenges_pruned == 1
        assert report.expired_login_throttles_pruned == 1
        assert report.stale_photos_cleaned == 2

        assert len(db.scalars(select(UserSession)).all()) == 1
        assert len(db.scalars(select(PhoneOtpChallenge)).all()) == 1
        assert len(db.scalars(select(LoginThrottle)).all()) == 1
        assert len(db.scalars(select(Photo)).all()) == 1
        assert not storage.exists(k_del)
        assert not storage.exists(k_del_thumb)
        assert not storage.exists(k_up)
        assert storage.exists(k_ready)

        # Standalone helpers check cleanly
        assert prune_expired_auth_artifacts(db, dry_run=True, now=now)["expired_sessions_pruned"] == 0
        assert cleanup_stale_photos(db, storage, dry_run=True, now=now) == 0


def test_list_trash_prunes_via_maintenance_service(client, database):
    assert register_verified(client, "trash-prune@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Хугацаа дууссан хогийн сав"}).json()
    fid = family["id"]

    p1 = client.post(
        f"/api/v1/families/{fid}/persons",
        json={"first_name": "Хуучин", "last_name": "Бүртгэл", "gender": "male"},
    ).json()
    client.delete(f"/api/v1/families/{fid}/persons/{p1['id']}")

    with database() as db:
        rec = db.scalar(
            select(FamilyTrashRecord).where(FamilyTrashRecord.person_id == UUID(p1["id"]))
        )
        assert rec is not None
        rec.deleted_at = datetime.now(UTC) - timedelta(days=31)
        db.commit()

    trash = client.get(f"/api/v1/families/{fid}/trash").json()
    assert trash == []


def test_run_maintenance_cli_dry_run_smoke(tmp_path):
    import os

    from sqlalchemy import create_engine

    from app.db import Base

    backend_dir = Path(__file__).resolve().parent.parent
    db_path = tmp_path / "cli_smoke.db"
    db_url = f"sqlite:///{db_path.as_posix()}"
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    env["APP_ENV"] = "test"

    proc = subprocess.run(
        [
            sys.executable,
            "scripts/run_maintenance.py",
            "--dry-run",
            "--skip-photos",
            "--json",
        ],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["dry_run"] is True
    assert payload["retention_days"] == 30
