"""Authentication router aggregator and backward-compatible symbol facade."""

from fastapi import APIRouter

from app.auth_core import (
    GOOGLE_STATE_COOKIE,
    GOOGLE_STATE_SECONDS,
    OTP_COOLDOWN_SECONDS,
    OTP_MAX_ATTEMPTS,
    OTP_SECONDS,
    PASSWORD_MIN_LENGTH,
    SESSION_SECONDS,
    EmailAddressInput,
    EmailTokenInput,
    GenericEmailResponse,
    IdentityLinkInput,
    IdentityLinkRequestOutput,
    LoginIdentityOutput,
    LoginInput,
    PasswordResetConfirmInput,
    RegisterInput,
    UserOutput,
    _consume_otp_rate,
    _normalized_ip,
    _password_hash,
    _password_matches,
    _token_hash,
    clear_session_cookie,
    get_current_user,
    set_session_cookie,
)
from app.auth_core import router as _core_router
from app.auth_oidc import (
    _consume_google_state,
    _google_provider,
    _read_google_state,
    _sign_google_state,
)
from app.auth_oidc import router as _oidc_router
from app.auth_otp import (
    PasswordRecoveryInput,
    PhoneLoginOutput,
    PhoneOtpRequestInput,
    PhoneOtpRequestOutput,
    PhoneOtpVerifyInput,
    PhoneRegisterInput,
    PhoneRegisterVerifyInput,
)
from app.auth_otp import router as _otp_router
from app.email import get_email_provider
from app.sms import get_sms_provider

router = APIRouter(prefix="/auth", tags=["authentication"])
router.include_router(_core_router)
router.include_router(_oidc_router)
router.include_router(_otp_router)

__all__ = [
    "GOOGLE_STATE_COOKIE",
    "GOOGLE_STATE_SECONDS",
    "OTP_COOLDOWN_SECONDS",
    "OTP_MAX_ATTEMPTS",
    "OTP_SECONDS",
    "PASSWORD_MIN_LENGTH",
    "SESSION_SECONDS",
    "EmailAddressInput",
    "EmailTokenInput",
    "GenericEmailResponse",
    "IdentityLinkInput",
    "IdentityLinkRequestOutput",
    "LoginIdentityOutput",
    "LoginInput",
    "PasswordRecoveryInput",
    "PasswordResetConfirmInput",
    "PhoneLoginOutput",
    "PhoneOtpRequestInput",
    "PhoneOtpRequestOutput",
    "PhoneOtpVerifyInput",
    "PhoneRegisterInput",
    "PhoneRegisterVerifyInput",
    "RegisterInput",
    "UserOutput",
    "_consume_google_state",
    "_consume_otp_rate",
    "_google_provider",
    "_normalized_ip",
    "_password_hash",
    "_password_matches",
    "_read_google_state",
    "_sign_google_state",
    "_token_hash",
    "clear_session_cookie",
    "get_current_user",
    "get_email_provider",
    "get_sms_provider",
    "router",
    "set_session_cookie",
]
