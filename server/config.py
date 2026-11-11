import base64
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


def share_authorization(password):
    credentials = base64.b64encode(f"campus:{password}".encode()).decode("ascii")
    return f"Basic {credentials}"


@dataclass(frozen=True)
class GraphSettings:
    tenant_id: str
    client_id: str
    sender: str
    cache_path: Path


@dataclass(frozen=True)
class MicrosoftLogin:
    tenant_id: str
    client_id: str
    client_secret: str


def graph_settings():
    try:
        tenant = str(UUID(os.getenv("GRAPH_TENANT_ID", "")))
        client = str(UUID(os.getenv("GRAPH_CLIENT_ID", "")))
    except ValueError:
        raise RuntimeError("Укажите Directory (tenant) ID и Application (client) ID из Microsoft Entra.") from None
    sender = os.getenv("GRAPH_SENDER", "").strip().lower()
    if not KBTU_EMAIL_PATTERN.fullmatch(sender):
        raise RuntimeError("Укажите логин корпоративного ящика @kbtu.kz в GRAPH_SENDER.")
    cache = ROOT / (os.getenv("GRAPH_TOKEN_CACHE") or ".mail-auth/graph.cache")
    return GraphSettings(tenant, client, sender, cache)


@dataclass(frozen=True)
class Settings:
    origin: str
    secure_cookie: bool
    secret: bytes
    mail_mode: str
    smtp_host: str
    smtp_port: int
    smtp_security: str
    smtp_user: str
    smtp_password: str
    smtp_from: str
    graph: GraphSettings | None
    code_signup: bool
    domain_signup: bool
    microsoft: MicrosoftLogin | None
    share_password: str | None
    loopback_origin: str | None


@lru_cache
def settings():
    environment = os.getenv("APP_ENV", "pilot")
    if environment not in ("dev", "pilot"):
        raise RuntimeError("APP_ENV: dev или pilot")
    pilot = environment == "pilot"
    origin = os.getenv("APP_ORIGIN", "").rstrip("/")
    parsed = urlsplit(origin)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or
            parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise RuntimeError("APP_ORIGIN должен содержать только схему, хост и порт")
    if pilot and parsed.scheme != "https":
        raise RuntimeError("В режиме pilot нужен HTTPS в APP_ORIGIN")
    if not pilot and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Режим dev предназначен для локального адреса")
    share_password = os.getenv("CAMPUS_SHARE_PASSWORD") or None
    if share_password and not pilot:
        raise RuntimeError("Для временной ссылки с паролем нужен режим pilot и HTTPS.")
    loopback_origin = os.getenv("CAMPUS_LOOPBACK_ORIGIN") or None
    if loopback_origin and (not share_password or not re.fullmatch(r"http://127[.]0[.]0[.]1:[0-9]+", loopback_origin)):
        raise RuntimeError("CAMPUS_LOOPBACK_ORIGIN должен быть адресом 127.0.0.1 с портом.")
    secret = os.getenv("APP_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("Создайте APP_SECRET командой python -c из README")
    auth_mode = os.getenv("AUTH_MODE", "code")
    if auth_mode not in ("code", "domain", "microsoft", "both"):
        raise RuntimeError("AUTH_MODE: code, domain, microsoft или both.")
    microsoft = None
    if auth_mode in ("microsoft", "both"):
        try:
            tenant_id = str(UUID(os.getenv("MS_LOGIN_TENANT_ID", "")))
            client_id = str(UUID(os.getenv("MS_LOGIN_CLIENT_ID", "")))
        except ValueError:
            raise RuntimeError("Укажите MS_LOGIN_TENANT_ID и MS_LOGIN_CLIENT_ID из Entra.") from None
        client_secret = os.getenv("MS_LOGIN_CLIENT_SECRET", "")
        if not client_secret:
            raise RuntimeError("Укажите значение секрета веб-приложения в MS_LOGIN_CLIENT_SECRET.")
        microsoft = MicrosoftLogin(tenant_id, client_id, client_secret)
    code_signup = auth_mode in ("code", "both")
    domain_signup = auth_mode == "domain"
    mode = os.getenv("MAIL_MODE", "smtp" if pilot else "file")
    security = os.getenv("SMTP_SECURITY", "starttls")
    if code_signup and (mode not in ("file", "smtp", "graph") or (pilot and mode == "file")):
        raise RuntimeError("MAIL_MODE: file, smtp или graph. Для pilot выберите smtp или graph.")
    graph = graph_settings() if code_signup and mode == "graph" else None
    smtp_enabled = code_signup and mode == "smtp"
    if smtp_enabled and security not in ("starttls", "ssl"):
        raise RuntimeError("SMTP_SECURITY: starttls или ssl")
    host = os.getenv("SMTP_HOST", "")
    sender = os.getenv("SMTP_FROM", "")
    username = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASSWORD", "")
    if smtp_enabled and (not host or not sender or bool(username) != bool(password)):
        raise RuntimeError("Заполните SMTP_HOST, SMTP_FROM и данные входа при необходимости")
    port = int(os.getenv("SMTP_PORT", "465" if security == "ssl" else "587")) if smtp_enabled else 587
    return Settings(origin, pilot, secret.encode(), mode, host,
                    port, security, username, password, sender, graph,
                    code_signup, domain_signup, microsoft, share_password, loopback_origin)
