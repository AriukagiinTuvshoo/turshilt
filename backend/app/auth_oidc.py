"""Google OIDC sign-in and identity linking endpoints."""

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth_core import (
    _OTP_DEV_SECRET,
    GOOGLE_STATE_COOKIE,
    GOOGLE_STATE_SECONDS,
    _consume_otp_rate,
    _normalized_ip,
    _token_hash,
    get_current_user,
    logger,
    set_session_cookie,
)
from app.config import get_settings
from app.db import get_db
from app.identity import email_is_registered, normalize_email
from app.models import AuditLog, LoginIdentity, LoginThrottle, User, UserSession
from app.oidc import ISSUER, GoogleOIDCProvider, OIDCError

router = APIRouter()


def _google_provider() -> GoogleOIDCProvider:
    settings = get_settings()
    if not settings.google_oidc_enabled or not all(
        (
            settings.google_oidc_client_id,
            settings.google_oidc_client_secret,
            settings.google_oidc_redirect_uri,
        )
    ):
        raise HTTPException(status_code=404, detail="Google нэвтрэх боломжгүй байна.")
    return GoogleOIDCProvider(
        settings.google_oidc_client_id or "",
        settings.google_oidc_client_secret or "",
        settings.google_oidc_redirect_uri or "",
    )


def _resolve_google_provider() -> GoogleOIDCProvider:
    import app.auth as auth_module

    return auth_module._google_provider()


def _google_state_secret() -> bytes:
    settings = get_settings()
    if settings.google_oidc_state_secret:
        return settings.google_oidc_state_secret.encode()
    # Development-only process fallback; production settings reject a missing secret.
    if settings.app_env.lower() == "production":
        raise RuntimeError("GOOGLE_OIDC_STATE_SECRET is required")
    return _OTP_DEV_SECRET


def _sign_google_state(payload: dict) -> str:
    encoded = (
        base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode())
        .rstrip(b"=")
    )
    signature = hmac.new(_google_state_secret(), encoded, hashlib.sha256).digest()
    return encoded.decode() + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def _read_google_state(value: str) -> dict | None:
    try:
        encoded, supplied = value.split(".", 1)
        expected = hmac.new(_google_state_secret(), encoded.encode(), hashlib.sha256).digest()
        signature = base64.urlsafe_b64decode(supplied + "=" * (-len(supplied) % 4))
        if not hmac.compare_digest(expected, signature):
            return None
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if int(payload["iat"]) < int(datetime.now(UTC).timestamp()) - GOOGLE_STATE_SECONDS:
            return None
        if payload.get("flow") not in {"login", "link"}:
            return None
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def _google_state_key(state: str) -> str:
    return hmac.new(
        _google_state_secret(), f"google-state\0{state}".encode(), hashlib.sha256
    ).hexdigest()


def _consume_google_state(db: Session, state: str) -> bool:
    now = datetime.now(UTC)
    result = db.execute(
        update(LoginThrottle)
        .where(
            LoginThrottle.key_hash == _google_state_key(state),
            LoginThrottle.attempts == 0,
            LoginThrottle.window_started >= now - timedelta(seconds=GOOGLE_STATE_SECONDS),
        )
        .values(attempts=1)
    )
    db.commit()
    return result.rowcount == 1


def _start_google(
    flow: str, db: Session, request: Request, user_id: UUID | None = None
):
    if not _consume_otp_rate(db, "google-start", _normalized_ip(request), 10):
        raise HTTPException(
            status_code=429, detail="Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу."
        )
    provider = _resolve_google_provider()
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.add(LoginThrottle(key_hash=_google_state_key(state), window_started=now, attempts=0))
    db.commit()
    cookie = _sign_google_state(
        {
            "state": state,
            "nonce": nonce,
            "flow": flow,
            "user_id": str(user_id) if user_id else None,
            "iat": int(now.timestamp()),
        }
    )
    redirect = RedirectResponse(provider.authorization_url(state, nonce), status_code=303)
    settings = get_settings()
    redirect.set_cookie(
        GOOGLE_STATE_COOKIE,
        cookie,
        max_age=GOOGLE_STATE_SECONDS,
        httponly=True,
        secure=settings.app_env.lower() == "production",
        samesite="lax",
        path="/api/v1/auth/google/callback",
    )
    return redirect


def _google_frontend_redirect(result: str) -> RedirectResponse:
    settings = get_settings()
    origin = settings.cors_origin_list[0] if settings.cors_origin_list else "http://localhost:3000"
    path = "/dashboard" if result == "success" else "/login"
    return RedirectResponse(f"{origin}{path}?google={result}", status_code=303)


@router.get("/google/config")
def google_login_config():
    return {"enabled": get_settings().google_oidc_enabled}


@router.get("/google/start")
def google_login_start(request: Request, db: Session = Depends(get_db)):
    return _start_google("login", db, request)


@router.post("/me/google/start")
def google_link_start(
    request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return _start_google("link", db, request, user.id)


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if not _consume_otp_rate(db, "google-callback", _normalized_ip(request), 20):
        response = _google_frontend_redirect("failed")
        response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
        return response
    state_payload = _read_google_state(request.cookies.get(GOOGLE_STATE_COOKIE, ""))
    if (
        error
        or not code
        or not state
        or state_payload is None
        or not hmac.compare_digest(state, str(state_payload.get("state", "")))
        or not _consume_google_state(db, state)
    ):
        logger.info(
            "Google OIDC callback rejected",
            extra={
                "event": "google_callback_rejected",
                "request_id": getattr(request.state, "request_id", None),
            },
        )
        result = "failed"
        response = _google_frontend_redirect(result)
        response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
        return response

    try:
        provider = _resolve_google_provider()
        claims = provider.verify(provider.exchange(code), str(state_payload["nonce"]))
        subject = claims["sub"]
        email = normalize_email(str(TypeAdapter(EmailStr).validate_python(claims["email"])))
    except (OIDCError, ValidationError, ValueError, HTTPException):
        logger.info(
            "Google OIDC claim validation failed",
            extra={
                "event": "google_claim_validation_failed",
                "request_id": getattr(request.state, "request_id", None),
            },
        )
        response = _google_frontend_redirect("failed")
        response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
        return response

    flow = state_payload["flow"]
    issuer = ISSUER
    identity = db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.provider == "google",
            LoginIdentity.issuer == issuer,
            LoginIdentity.subject == subject,
            LoginIdentity.disabled_at.is_(None),
        )
    )
    if flow == "link":
        try:
            expected_user_id = UUID(state_payload["user_id"])
        except (ValueError, TypeError):
            expected_user_id = None
        session_token = request.cookies.get(get_settings().session_cookie_name)
        current_session = db.scalar(
            select(UserSession).where(
                UserSession.token_hash == _token_hash(session_token or ""),
                UserSession.expires_at > datetime.now(UTC),
            )
        )
        link_user = db.get(User, expected_user_id) if expected_user_id else None
        if (
            not expected_user_id
            or not current_session
            or current_session.user_id != expected_user_id
            or not link_user
            or not link_user.is_active
        ):
            result = "failed"
        elif identity and identity.user_id != expected_user_id:
            db.add(
                AuditLog(
                    actor_id=expected_user_id,
                    action="google.identity_conflict",
                    target_type="google_identity",
                )
            )
            db.commit()
            result = "failed"
        elif identity:
            result = "success"
        else:
            db.add(
                LoginIdentity(
                    user_id=expected_user_id,
                    provider="google",
                    issuer=issuer,
                    subject=subject,
                    display_identifier=email,
                    verified_at=datetime.now(UTC),
                )
            )
            db.add(
                AuditLog(
                    actor_id=expected_user_id,
                    action="google.identity_linked",
                    target_type="google_identity",
                )
            )
            try:
                db.commit()
                result = "success"
            except IntegrityError:
                db.rollback()
                result = "failed"
    else:
        user = db.get(User, identity.user_id) if identity else None
        if identity and user and user.is_active:
            response = _google_frontend_redirect("success")
            set_session_cookie(db, response, user.id)
            response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
            return response
        # Verified Google email is not proof of ownership of a pre-existing app account.
        if identity is None and email_is_registered(db, email):
            result = "failed"
        elif identity is None:
            user = User(
                email=email,
                display_name=str(claims.get("name") or email.partition("@")[0])[:120],
                password_hash=None,
                email_verified_at=datetime.now(UTC),
            )
            db.add(user)
            db.flush()
            db.add(
                LoginIdentity(
                    user_id=user.id,
                    provider="google",
                    issuer=issuer,
                    subject=subject,
                    display_identifier=email,
                    verified_at=datetime.now(UTC),
                )
            )
            db.add(
                AuditLog(
                    actor_id=user.id,
                    action="google.account_created",
                    target_type="user",
                    target_id=user.id,
                )
            )
            try:
                db.commit()
                response = _google_frontend_redirect("success")
                set_session_cookie(db, response, user.id)
                response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
                return response
            except IntegrityError:
                db.rollback()
                result = "failed"
        else:
            result = "failed"

    response = _google_frontend_redirect(result)
    response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
    return response
