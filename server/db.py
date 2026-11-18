from typing import Annotated

from anyio import CancelScope, to_thread
from fastapi import Depends, Request
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import database_url

MIGRATION_VERSION = 7


def make_pool():
    return ConnectionPool(
        database_url(), min_size=1, max_size=8, open=False, timeout=5,
        kwargs={"autocommit": True, "row_factory": dict_row, "connect_timeout": 10,
                "options": "-c search_path=public -c timezone=UTC"},
        check=ConnectionPool.check_connection,
    )


async def connection(request: Request):
    pool = request.app.state.pool
    # Ожидающие БД запросы не занимают потоки, которые нужны обработчикам FastAPI.
    conn = await to_thread.run_sync(pool.getconn, limiter=request.app.state.connection_limiter)
    try:
        yield conn
    finally:
        with CancelScope(shield=True):
            await to_thread.run_sync(pool.putconn, conn)


Db = Annotated[Connection, Depends(connection)]
