"""Phone OTP registration, login, linking, and password recovery endpoints."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth_core import (
    OTP_COOLDOWN_SECONDS,
    OTP_MAX_ATTEMPTS,
    OTP_SECONDS,
    PASSWORD_MIN_LENGTH,
    LoginIdentityOutput,
    UserOutput,
    _audit_auth_event,
    _consume_otp_rate,
    _normalized_ip,
    _otp_rate_key,
    _otp_secret,
    _password_hash,
    _user_output,
    get_current_user,
    set_session_cookie,
)
from app.config import get_settings
from app.db import get_db
from app.identity import normalize_phone
from app.models import AuditLog, LoginIdentity, PhoneOtpChallenge, User, UserSession
from app.observability import request_id_context
from app.sms import SmsProvider, get_sms_provider

router = APIRouter()


class PhoneOtpRequestInput(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def canonical_phone(cls, value: str) -> str:
        try:
            return normalize_phone(value)
        except ValueError as error:
            raise ValueError(str(error)) from error


class PhoneRegisterInput(PhoneOtpRequestInput):
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Нэр хоосон байж болохгүй.")
        return value


class PhoneOtpRequestOutput(BaseModel):
    challenge_id: UUID
    expires_in: int
    resend_after: int


class PhoneOtpVerifyInput(PhoneOtpRequestInput):
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{6}$")


class PhoneRegisterVerifyInput(PhoneOtpVerifyInput):
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Нэр хоосон байж болохгүй.")
        return value


class PasswordRecoveryInput(PhoneOtpVerifyInput):
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=128)


class PhoneLoginOutput(UserOutput):
    pass


def _otp_digest(challenge_id: UUID, phone: str, purpose: str, code: str) -> str:
    message = f"{challenge_id}\0{phone}\0{purpose}\0{code}".encode()
    return hmac.new(_otp_secret(), message, hashlib.sha256).hexdigest()


def _phone_identity(db: Session, phone: str) -> LoginIdentity | None:
    return db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.provider == "phone",
            LoginIdentity.normalized_identifier == phone,
            LoginIdentity.verified_at.is_not(None),
            LoginIdentity.disabled_at.is_(None),
        )
    )


def _create_phone_challenge(
    *,
    db: Session,
    request: Request,
    phone: str,
    purpose: str,
    user_id: UUID | None,
    sms: SmsProvider,
) -> PhoneOtpRequestOutput:
    now = datetime.now(UTC)
    db.execute(
        delete(PhoneOtpChallenge).where(PhoneOtpChallenge.created_at < now - timedelta(days=90))
    )
    recent = db.scalar(
        select(PhoneOtpChallenge)
        .where(
            PhoneOtpChallenge.phone_e164 == phone,
            PhoneOtpChallenge.purpose == purpose,
            PhoneOtpChallenge.created_at > now - timedelta(seconds=OTP_COOLDOWN_SECONDS),
        )
        .order_by(PhoneOtpChallenge.created_at.desc())
    )
    if recent:
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    if not _consume_otp_rate(db, "phone", phone, 3):
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    if not _consume_otp_rate(db, "ip", _normalized_ip(request), 10):
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    if user_id and not _consume_otp_rate(db, "user", str(user_id), 6):
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    previous = db.scalars(
        select(PhoneOtpChallenge).where(
            PhoneOtpChallenge.phone_e164 == phone,
            PhoneOtpChallenge.purpose == purpose,
            PhoneOtpChallenge.status == "pending",
        )
    ).all()
    for item in previous:
        item.status = "superseded"
    challenge_id = UUID(bytes=secrets.token_bytes(16), version=4)
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = PhoneOtpChallenge(
        id=challenge_id,
        user_id=user_id,
        phone_e164=phone,
        purpose=purpose,
        code_hash=_otp_digest(challenge_id, phone, purpose, code),
        status="pending",
        attempt_count=0,
        max_attempts=OTP_MAX_ATTEMPTS,
        expires_at=now + timedelta(seconds=OTP_SECONDS),
        request_ip_hash=_otp_rate_key("ip", _normalized_ip(request)),
    )
    db.add(challenge)
    db.commit()
    try:
        sms.send_otp(phone, code, purpose)
    except Exception as error:
        stale = db.get(PhoneOtpChallenge, challenge_id)
        if stale is not None:
            stale.status = "expired"
            db.commit()
        raise HTTPException(
            status_code=503, detail="Код илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу."
        ) from error
    return PhoneOtpRequestOutput(
        challenge_id=challenge_id, expires_in=OTP_SECONDS, resend_after=OTP_COOLDOWN_SECONDS
    )


def _matching_otp(
    db: Session,
    *,
    challenge_id: UUID,
    phone: str,
    purpose: str,
    user_id: UUID | None,
    code: str,
) -> PhoneOtpChallenge | None:
    challenge = db.scalar(
        select(PhoneOtpChallenge)
        .where(
            PhoneOtpChallenge.id == challenge_id,
            PhoneOtpChallenge.phone_e164 == phone,
            PhoneOtpChallenge.purpose == purpose,
            PhoneOtpChallenge.status == "pending",
        )
        .with_for_update()
    )
    if challenge is None or (user_id is not None and challenge.user_id != user_id):
        return None
    now = datetime.now(UTC)
    expires = challenge.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires <= now:
        challenge.status = "expired"
        db.commit()
        return None
    if challenge.attempt_count >= challenge.max_attempts:
        challenge.status = "locked"
        db.commit()
        return None
    expected = challenge.code_hash
    supplied = _otp_digest(challenge.id, phone, purpose, code)
    if not hmac.compare_digest(expected, supplied):
        challenge.attempt_count += 1
        if challenge.attempt_count >= challenge.max_attempts:
            challenge.status = "locked"
        db.commit()
        return None
    return challenge


def _audit(db: Session, user_id: UUID, action: str, challenge: PhoneOtpChallenge) -> None:
    db.add(
        AuditLog(
            actor_id=user_id,
            action=action,
            target_type="phone_otp_challenge",
            target_id=challenge.id,
            request_id=request_id_context.get(),
        )
    )


@router.get("/phone/config")
def phone_auth_config():
    """Expose only whether real SMS delivery is configured for auth UI."""
    settings = get_settings()
    enabled = settings.sms_provider.lower() == "twilio" and all(
        (settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from_number)
    )
    return {"enabled": enabled}


@router.post("/me/phone/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_link(
    body: PhoneOtpRequestInput,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    phone = body.phone
    if db.scalar(
        select(LoginIdentity.id).where(
            LoginIdentity.provider == "phone",
            LoginIdentity.normalized_identifier == phone,
            LoginIdentity.disabled_at.is_(None),
        )
    ):
        db.add(
            AuditLog(
                actor_id=user.id,
                action="phone.identity_conflict",
                target_type="phone_identity",
            )
        )
        db.commit()
        raise HTTPException(status_code=409, detail="Энэ дугаарыг холбох боломжгүй.")
    response = _create_phone_challenge(
        db=db,
        request=request,
        phone=phone,
        purpose="phone_link",
        user_id=user.id,
        sms=sms,
    )
    challenge = db.get(PhoneOtpChallenge, response.challenge_id)
    if challenge is not None:
        _audit(db, user.id, "phone.otp_requested", challenge)
        db.commit()
    return response


@router.post("/me/phone/verify", response_model=LoginIdentityOutput)
def verify_phone_link(
    body: PhoneOtpVerifyInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="phone_link",
        user_id=user.id,
        code=body.code,
    )
    if challenge is None:
        raise HTTPException(status_code=400, detail="Код буруу эсвэл хугацаа дууссан байна.")
    identity = LoginIdentity(
        user_id=user.id,
        provider="phone",
        normalized_identifier=body.phone,
        display_identifier=body.phone,
        verified_at=datetime.now(UTC),
    )
    challenge.status = "consumed"
    challenge.consumed_at = datetime.now(UTC)
    db.add(identity)
    _audit(db, user.id, "phone.otp_verified", challenge)
    _audit(db, user.id, "phone.identity_linked", challenge)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        db.add(
            AuditLog(
                actor_id=user.id,
                action="phone.identity_conflict",
                target_type="phone_identity",
            )
        )
        db.commit()
        raise HTTPException(status_code=409, detail="Энэ дугаарыг холбох боломжгүй.") from error
    db.refresh(identity)
    return LoginIdentityOutput(
        id=identity.id,
        provider=identity.provider,
        display_identifier=identity.display_identifier,
        verified=True,
        created_at=identity.created_at,
    )


@router.post("/phone/register/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_registration(
    body: PhoneRegisterInput,
    request: Request,
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    identity = _phone_identity(db, body.phone)
    return _create_phone_challenge(
        db=db,
        request=request,
        phone=body.phone,
        purpose="phone_registration",
        user_id=identity.user_id if identity else None,
        sms=sms,
    )


@router.post("/phone/register/verify", response_model=UserOutput)
def verify_phone_registration(
    body: PhoneRegisterVerifyInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    if not _consume_otp_rate(db, "login-ip", _normalized_ip(request), 10):
        raise HTTPException(
            status_code=429, detail="Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу."
        )
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="phone_registration",
        user_id=None,
        code=body.code,
    )
    if challenge is None:
        raise HTTPException(status_code=400, detail="Код буруу эсвэл хугацаа дууссан байна.")

    identity = _phone_identity(db, body.phone)
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=400, detail="Баталгаажуулалт дууссангүй. Дахин оролдоно уу."
            )
        challenge.status = "consumed"
        challenge.consumed_at = datetime.now(UTC)
        _audit(db, user.id, "phone.registration_verified_existing", challenge)
        db.commit()
        set_session_cookie(db, response, user.id)
        return _user_output(db, user)

    user = User(
        email=None,
        display_name=body.display_name,
        password_hash=None,
        email_verified_at=None,
    )
    db.add(user)
    try:
        db.flush()
        identity = LoginIdentity(
            user_id=user.id,
            provider="phone",
            normalized_identifier=body.phone,
            display_identifier=body.phone,
            verified_at=datetime.now(UTC),
        )
        challenge.user_id = user.id
        challenge.status = "consumed"
        challenge.consumed_at = datetime.now(UTC)
        db.add(identity)
        _audit_auth_event(db, user.id, "phone.registration_verified", "phone_identity", identity.id)
        db.add(
            AuditLog(
                actor_id=user.id,
                action="user.registered",
                target_type="user",
                target_id=user.id,
                request_id=request_id_context.get(),
            )
        )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        identity = _phone_identity(db, body.phone)
        user = db.get(User, identity.user_id) if identity else None
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=409, detail="Бүртгэлийг дуусгаж чадсангүй. Дахин оролдоно уу."
            ) from error
        challenge = db.get(PhoneOtpChallenge, body.challenge_id)
        if challenge is not None:
            challenge.status = "consumed"
            challenge.consumed_at = datetime.now(UTC)
            _audit(db, user.id, "phone.registration_verified_existing", challenge)
            db.commit()
        else:
            raise HTTPException(status_code=409, detail="Бүртгэлийг дуусгаж чадсангүй.") from error
    db.refresh(user)
    set_session_cookie(db, response, user.id)
    return _user_output(db, user)


@router.post("/phone/login/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_login(
    body: PhoneOtpRequestInput,
    request: Request,
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    identity = _phone_identity(db, body.phone)
    challenge = _create_phone_challenge(
        db=db,
        request=request,
        phone=body.phone,
        purpose="phone_login",
        user_id=identity.user_id if identity else None,
        sms=sms,
    )
    if identity:
        item = db.get(PhoneOtpChallenge, challenge.challenge_id)
        if item is not None:
            _audit(db, identity.user_id, "phone.otp_requested", item)
            db.commit()
    return challenge


@router.post("/phone/login/verify", response_model=PhoneLoginOutput)
def verify_phone_login(
    body: PhoneOtpVerifyInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    if not _consume_otp_rate(db, "login-ip", _normalized_ip(request), 10):
        raise HTTPException(
            status_code=429, detail="Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу."
        )
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="phone_login",
        user_id=None,
        code=body.code,
    )
    identity = _phone_identity(db, body.phone) if challenge else None
    user = db.get(User, identity.user_id) if identity else None
    if challenge is None or user is None or not user.is_active:
        raise HTTPException(
            status_code=401, detail="Утасны код буруу эсвэл хугацаа дууссан байна."
        )
    challenge.status = "consumed"
    challenge.consumed_at = datetime.now(UTC)
    _audit(db, user.id, "phone.login_verified", challenge)
    db.flush()
    set_session_cookie(db, response, user.id)
    return _user_output(db, user)


@router.post("/password-reset/phone/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_recovery(
    body: PhoneOtpRequestInput,
    request: Request,
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    identity = _phone_identity(db, body.phone)
    challenge = _create_phone_challenge(
        db=db,
        request=request,
        phone=body.phone,
        purpose="password_recovery",
        user_id=identity.user_id if identity else None,
        sms=sms,
    )
    if identity:
        item = db.get(PhoneOtpChallenge, challenge.challenge_id)
        if item is not None:
            _audit(db, identity.user_id, "phone.otp_requested", item)
            db.commit()
    return challenge


@router.post("/password-reset/phone/confirm", status_code=204)
def confirm_phone_recovery(
    body: PasswordRecoveryInput,
    db: Session = Depends(get_db),
):
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="password_recovery",
        user_id=None,
        code=body.code,
    )
    identity = _phone_identity(db, body.phone) if challenge else None
    user = db.get(User, identity.user_id) if identity else None
    if challenge is None or user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Сэргээх хүсэлт баталгаажаагүй байна.")
    user.password_hash = _password_hash(body.new_password)
    challenge.status = "consumed"
    challenge.consumed_at = datetime.now(UTC)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    _audit(db, user.id, "password.reset_completed", challenge)
    _audit(db, user.id, "sessions.invalidated", challenge)
    db.commit()
    return Response(status_code=204)
