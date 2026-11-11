from contextlib import asynccontextmanager
from hmac import compare_digest

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from psycopg.errors import ForeignKeyViolation
from psycopg_pool import PoolTimeout

from . import auth, events, microsoft, social
from .config import ROOT, settings, share_authorization
from .db import Db, MIGRATION_VERSION, make_pool


@asynccontextmanager
async def lifespan(app):
    settings()
    pool = make_pool()
    with pool:
        pool.wait(timeout=10)
        with pool.connection() as db:
            table = db.execute("SELECT to_regclass('campus_migrations') AS name").fetchone()
            if not table["name"]:
                raise RuntimeError("Сначала выполните python -m server.manage migrate")
            versions = {row["version"] for row in db.execute("SELECT version FROM campus_migrations")}
            if versions != set(range(1, MIGRATION_VERSION + 1)):
                raise RuntimeError("Версия базы не совпадает с версией приложения.")
        app.state.pool = pool
        yield


app = FastAPI(title="Campus Threads", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(microsoft.router)
app.include_router(social.router)
app.include_router(events.router)


@app.middleware("http")
async def browser_policy(request: Request, call_next):
    config = settings()
    if config.share_password:
        expected = share_authorization(config.share_password).encode("ascii")
        supplied = request.headers.get("authorization", "").encode("latin-1")
        if not compare_digest(supplied, expected):
            return PlainTextResponse(
                "Временная ссылка Campus Threads. Введите логин campus и пароль от организатора.",
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Campus Threads"', "Cache-Control": "no-store"},
            )
    api = request.url.path.startswith("/api/")
    if api and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origins = {config.origin}
        if config.loopback_origin:
            origins.add(config.loopback_origin)
        if request.headers.get("origin") not in origins:
            return JSONResponse({"detail": "Откройте приложение по его основному адресу."}, status_code=403)
    response = await call_next(request)
    if api:
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    # Ошибка API не возвращает исходный ввод (в том числе пароль и код).
    fields = ", ".join(str(error["loc"][-1]) for error in exc.errors())
    return JSONResponse({"detail": f"Проверьте поля формы ({fields})."}, status_code=422)


@app.exception_handler(ForeignKeyViolation)
async def missing_record(request, exc):
    return JSONResponse({"detail": "Связанная запись больше недоступна."}, status_code=404)


@app.exception_handler(PoolTimeout)
async def database_unavailable(request, exc):
    return JSONResponse({"detail": "База временно недоступна. Попробуйте ещё раз."}, status_code=503)


@app.get("/api/health", tags=["Сервер"])
def health(db: Db):
    db.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(ROOT / "pilot/index.html", headers={"Cache-Control": "no-cache"})


@app.get("/assets/styles.css", include_in_schema=False)
def styles():
    return FileResponse(ROOT / "site/styles.css")


@app.get("/assets/favicon.svg", include_in_schema=False)
def favicon():
    return FileResponse(ROOT / "site/favicon.svg")


@app.get("/assets/ui.js", include_in_schema=False)
def ui():
    return FileResponse(ROOT / "site/ui.js", media_type="text/javascript")


app.mount("/assets", StaticFiles(directory=ROOT / "pilot/assets"), name="assets")
