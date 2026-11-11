"""Делегированная отправка через почтовый ящик, подключённый владельцем."""
import base64
import hmac
import json
from contextlib import closing
from functools import lru_cache
from http.client import HTTPException, HTTPSConnection
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock

from cryptography.fernet import Fernet, InvalidToken
from msal import PublicClientApplication, SerializableTokenCache

from .config import GraphSettings

SCOPES = ["https://graph.microsoft.com/Mail.Send"]
_cache_lock = Lock()


class GraphMailError(Exception):
    pass


def cache_cipher(config: GraphSettings, app_secret: bytes):
    context = f"Campus Threads Graph cache v1:{config.tenant_id}:{config.client_id}:{config.sender}"
    return Fernet(base64.urlsafe_b64encode(hmac.digest(app_secret, context.encode(), "sha256")))


def save_cache(path: Path, cache, cipher):
    encrypted = cipher.encrypt(cache.serialize().encode())
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temp = Path(file.name)
        try:
            file.write(encrypted)
            file.close()
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def graph_client(config: GraphSettings, cache):
    try:
        return PublicClientApplication(
            config.client_id, authority=f"https://login.microsoftonline.com/{config.tenant_id}",
            token_cache=cache, timeout=10, instance_discovery=False,
        )
    except ValueError:
        raise GraphMailError("Microsoft Entra не принял настройки приложения или каталога.") from None


def authorize(config: GraphSettings, app_secret: bytes):
    cache = SerializableTokenCache()
    client = graph_client(config, cache)
    result = client.acquire_token_interactive(
        scopes=SCOPES, login_hint=config.sender, prompt="select_account", timeout=180,
    )
    if not result.get("access_token"):
        codes = ", ".join(f"AADSTS{code}" for code in result.get("error_codes", []) if isinstance(code, int))
        raise GraphMailError(f"Microsoft не выдал разрешение Mail.Send. {codes}".rstrip())
    if len(client.get_accounts(username=config.sender)) != 1:
        raise GraphMailError("Войдите тем корпоративным аккаунтом, который указан в GRAPH_SENDER.")
    save_cache(config.cache_path, cache, cache_cipher(config, app_secret))


@lru_cache(maxsize=1)
def load_client(config: GraphSettings, app_secret: bytes):
    cipher = cache_cipher(config, app_secret)
    cache = SerializableTokenCache()
    try:
        cache.deserialize(cipher.decrypt(config.cache_path.read_bytes()).decode())
    except (FileNotFoundError, InvalidToken):
        raise GraphMailError("Подключите почту командой python -m server.mail authorize.") from None
    return graph_client(config, cache), cache, cipher


def access_token(config: GraphSettings, app_secret: bytes):
    # Запись кеша и обновление токена выполняются последовательно в одном процессе.
    with _cache_lock:
        client, cache, cipher = load_client(config, app_secret)
        accounts = client.get_accounts(username=config.sender)
        if len(accounts) != 1:
            raise GraphMailError("Подключите корпоративный аккаунт из GRAPH_SENDER.")
        result = client.acquire_token_silent(SCOPES, account=accounts[0])
        if cache.has_state_changed:
            save_cache(config.cache_path, cache, cipher)
        if not result or not result.get("access_token"):
            raise GraphMailError("Microsoft требует повторного входа. Запустите server.mail authorize.")
        return result["access_token"]


def send_graph(config: GraphSettings, app_secret: bytes, recipient: str, subject: str, text: str):
    token = access_token(config, app_secret)
    body = json.dumps({
        "message": {
            "subject": subject,
            "body": {"contentType": "Text", "content": text},
            "toRecipients": [{"emailAddress": {"address": recipient}}],
        },
        "saveToSentItems": False,
    }).encode()
    try:
        with closing(HTTPSConnection("graph.microsoft.com", timeout=10)) as connection:
            # /me отправляет от того ящика, который владелец подключил в authorize.
            connection.request("POST", "/v1.0/me/sendMail", body, {
                "Authorization": f"Bearer {token}", "Content-Type": "application/json",
            })
            with connection.getresponse() as response:
                if response.status != 202:
                    raise GraphMailError(f"Microsoft Graph отклонил отправку (HTTP {response.status}).")
    except (OSError, HTTPException):
        raise GraphMailError("Не удалось подключиться к Microsoft Graph.") from None
