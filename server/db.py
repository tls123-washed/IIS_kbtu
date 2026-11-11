from typing import Annotated

from fastapi import Depends, Request
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import database_url

MIGRATION_VERSION = 7


def make_pool():
    return ConnectionPool(
        database_url(), min_size=1, max_size=8, open=False, timeout=5,
        kwargs={"autocommit": True, "row_factory": dict_row, "connect_timeout": 5,
                "options": "-c search_path=public -c timezone=UTC"},
    )


def connection(request: Request):
    with request.app.state.pool.connection() as conn:
        yield conn


Db = Annotated[Connection, Depends(connection)]
