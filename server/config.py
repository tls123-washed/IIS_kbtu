import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
KBTU_EMAIL_PATTERN = re.compile(r"[a-z0-9_+%-]+(?:[.][a-z0-9_+%-]+)*@kbtu[.]kz")
load_dotenv(ROOT / ".env")


def database_url():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("Укажите DATABASE_URL в .env")
    return url


@dataclass(frozen=True)
class MicrosoftLogin:
    tenant_id: str
    client_id: str
    client_secret: str


@dataclass(frozen=True)
class Settings:
    origin: str
    secure_cookie: bool
    secret: bytes
    domain_signup: bool
    microsoft: MicrosoftLogin | None
    loopback_origin: str | None


@lru_cache
def settings():
    environment = os.getenv("APP_ENV", "pilot")
    if environment not in ("dev", "pilot"):
        raise RuntimeError("APP_ENV: dev или pilot")
    pilot = environment == "pilot"
    origin = (os.getenv("APP_ORIGIN") or os.getenv("RENDER_EXTERNAL_URL", "")).rstrip("/")
    parsed = urlsplit(origin)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or
            parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise RuntimeError("APP_ORIGIN должен содержать только схему, хост и порт")
    if pilot and parsed.scheme != "https":
        raise RuntimeError("В режиме pilot нужен HTTPS в APP_ORIGIN")
    if not pilot and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Режим dev предназначен для локального адреса")
    loopback_origin = os.getenv("CAMPUS_LOOPBACK_ORIGIN") or None
    if loopback_origin and not re.fullmatch(r"http://127[.]0[.]0[.]1:[0-9]+", loopback_origin):
        raise RuntimeError("CAMPUS_LOOPBACK_ORIGIN должен быть адресом 127.0.0.1 с портом.")
    secret = os.getenv("APP_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("Создайте APP_SECRET командой python -c из README")
    auth_mode = os.getenv("AUTH_MODE", "domain")
    # Старые значения не могут вернуть удалённую регистрацию по письму.
    if auth_mode in ("code", "both"):
        auth_mode = "domain"
    if auth_mode not in ("domain", "microsoft"):
        raise RuntimeError("AUTH_MODE: domain или microsoft.")
    microsoft = None
    if auth_mode == "microsoft":
        try:
            tenant_id = str(UUID(os.getenv("MS_LOGIN_TENANT_ID", "")))
            client_id = str(UUID(os.getenv("MS_LOGIN_CLIENT_ID", "")))
        except ValueError:
            raise RuntimeError("Укажите MS_LOGIN_TENANT_ID и MS_LOGIN_CLIENT_ID из Entra.") from None
        client_secret = os.getenv("MS_LOGIN_CLIENT_SECRET", "")
        if not client_secret:
            raise RuntimeError("Укажите значение секрета веб-приложения в MS_LOGIN_CLIENT_SECRET.")
        microsoft = MicrosoftLogin(tenant_id, client_id, client_secret)
    domain_signup = auth_mode == "domain"
    return Settings(origin, pilot, secret.encode(), domain_signup, microsoft, loopback_origin)
