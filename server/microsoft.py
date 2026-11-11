"""Вход в Campus Threads. Отправка писем использует отдельное приложение Entra."""
import logging
import secrets
from functools import lru_cache
from urllib.parse import urlsplit
from uuid import UUID

import jwt
import msal
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from psycopg.types.json import Jsonb

from .auth import (
    StudentProfile, create_profile_transaction, digest, limit, session_user, set_cookie, start_session,
)
from .config import KBTU_EMAIL_PATTERN, settings
from .db import Db

PREFIX = "/api/auth/microsoft"
FLOW_COOKIE = "campus_ms_flow"
PROFILE_COOKIE = "campus_ms_profile"
router = APIRouter(prefix=PREFIX, tags=["Вход Microsoft"])
logger = logging.getLogger(__name__)


def enabled():
    config = settings()
    if config.microsoft is None:
        raise HTTPException(404, "Вход через Microsoft ещё не настроен.")
    return config


@lru_cache(maxsize=1)
def login_client(config):
    return msal.ConfidentialClientApplication(
        config.client_id, client_credential=config.client_secret,
        authority=f"https://login.microsoftonline.com/{config.tenant_id}",
        exclude_scopes=["offline_access"], timeout=5, instance_discovery=False,
    )


@lru_cache(maxsize=1)
def microsoft_keys(tenant_id):
    return jwt.PyJWKClient(f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys", timeout=5)


def exchange(config, flow, callback):
    # MSAL проверяет state и nonce и предъявляет PKCE verifier при обмене.
    result = login_client(config).acquire_token_by_auth_code_flow(flow, callback)
    token = result.get("id_token")
    if not token or not result.get("id_token_claims"):
        raise ValueError("Microsoft did not return an ID token")
    key = microsoft_keys(config.tenant_id).get_signing_key_from_jwt(token)
    return jwt.decode(
        token, key.key, algorithms=["RS256"], audience=config.client_id,
        issuer=f"https://login.microsoftonline.com/{config.tenant_id}/v2.0", leeway=60,
        options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]},
    )


def university_identity(claims, expected_tenant):
    try:
        tenant = UUID(claims["tid"])
        user = UUID(claims["oid"])
    except (KeyError, ValueError, TypeError, AttributeError):
        return None
    # oid + tid — постоянный ключ. UPN используется для адреса профиля и фильтра домена.
    upn = claims.get("preferred_username")
    email = upn.strip().lower() if isinstance(upn, str) else ""
    if (str(tenant) != expected_tenant or str(claims.get("acct")) != "0" or len(email) > 100
            or not KBTU_EMAIL_PATTERN.fullmatch(email)):
        return None
    return tenant, user, email


def browser_key(request, name):
    value = request.cookies.get(name, "")
    return digest(value) if len(value) == 43 else None


def set_flow_cookie(response, name, value):
    response.set_cookie(name, value, max_age=600, path=PREFIX, httponly=True,
                        secure=settings().secure_cookie, samesite="lax")


def clear_flow_cookie(response, name):
    response.delete_cookie(name, path=PREFIX, httponly=True, secure=settings().secure_cookie, samesite="lax")


def home(outcome):
    return RedirectResponse(f"/?microsoft={outcome}", status_code=303, headers={"Referrer-Policy": "no-referrer"})


@router.get("/start")
def start(request: Request, db: Db):
    config = enabled()
    if request.url.netloc != urlsplit(config.origin).netloc:
        return RedirectResponse(config.origin + PREFIX + "/start", status_code=303)
    limit(db, f"microsoft-ip:{request.client.host}", 30, "15 minutes")
    user = session_user(request, db)
    try:
        flow = login_client(config.microsoft).initiate_auth_code_flow(
            scopes=[], redirect_uri=config.origin + PREFIX + "/callback", prompt="select_account",
        )
        if not flow.get("auth_uri"):
            raise ValueError
    except (ValueError, RuntimeError, OSError):
        logger.warning("Не удалось начать вход Microsoft.")
        return home("failed")
    browser = secrets.token_urlsafe(32)
    db.execute("CALL campus_api.store_microsoft_flow(%s, %s, %s)",
               (digest(browser), Jsonb(flow), user["user_id"] if user else None))
    response = RedirectResponse(flow["auth_uri"], status_code=303)
    set_flow_cookie(response, FLOW_COOKIE, browser)
    clear_flow_cookie(response, PROFILE_COOKIE)
    return response


@router.get("/callback", include_in_schema=False)
def callback(request: Request, db: Db):
    config = enabled()
    key = browser_key(request, FLOW_COOKIE)
    state = request.query_params.get("state", "")
    if not key or not 1 <= len(state) <= 256:
        return home("failed")
    stored = db.execute("SELECT * FROM campus_api.take_microsoft_flow(%s, %s)", (key, state)).fetchone()
    if not stored:
        return home("failed")

    response = complete_flow(config, request, db, stored)
    clear_flow_cookie(response, FLOW_COOKIE)
    return response


def complete_flow(config, request, db, stored):
    local_user = session_user(request, db)
    local_id = local_user["user_id"] if local_user else None
    if local_id != stored["link_user_id"]:
        return home("failed")
    try:
        claims = exchange(config.microsoft, stored["flow"], dict(request.query_params))
    except (jwt.PyJWTError, ValueError, RuntimeError, OSError):
        logger.warning("Вход Microsoft не завершён. Проверьте настройки Entra или повторите вход.")
        return home("failed")
    identity = university_identity(claims, config.microsoft.tenant_id)
    if identity is None:
        return home("university")
    tenant, object_id, email = identity
    linked = db.execute("SELECT * FROM campus_api.microsoft_user(%s, %s)", (tenant, object_id)).fetchone()
    if local_id:
        if linked:
            return home("linked" if linked["user_id"] == local_id else "link_failed")
        result = db.execute("SELECT campus_api.link_microsoft(%s, %s, %s, %s) AS linked",
                            (tenant, object_id, local_id, email)).fetchone()
        return home("linked" if result["linked"] else "link_failed")
    if linked:
        response = home("signed_in")
        set_cookie(response, start_session(db, linked["user_id"]))
        return response
    browser = secrets.token_urlsafe(32)
    result = db.execute("SELECT campus_api.begin_microsoft_profile(%s, %s, %s, %s) AS started",
                        (digest(browser), tenant, object_id, email)).fetchone()
    if not result["started"]:
        return home("existing")
    response = home("profile")
    set_flow_cookie(response, PROFILE_COOKIE, browser)
    return response


@router.get("/profile")
def profile(request: Request, db: Db):
    enabled()
    row = db.execute("SELECT * FROM campus_api.microsoft_profile_email(%s)",
                     (browser_key(request, PROFILE_COOKIE),)).fetchone()
    if not row:
        raise HTTPException(401, "Срок входа истёк. Нажмите «Войти через Microsoft» снова.")
    return row


@router.post("/profile", status_code=201)
def create_profile(body: StudentProfile, request: Request, response: Response, db: Db):
    config = enabled()
    if session_user(request, db):
        raise HTTPException(409, "Вы уже вошли в Campus Threads.")
    with create_profile_transaction(db):
        user = db.execute(
            "SELECT * FROM campus_api.create_microsoft_student(%s, %s, %s, %s, %s, %s, %s)",
            (browser_key(request, PROFILE_COOKIE), UUID(config.microsoft.tenant_id),
             body.username, body.first, body.last, body.year, body.faculty),
        ).fetchone()
        if not user:
            raise HTTPException(401, "Срок входа истёк. Нажмите «Войти через Microsoft» снова.")
        token = start_session(db, user["user_id"])
    set_cookie(response, token)
    clear_flow_cookie(response, PROFILE_COOKIE)
    return user
