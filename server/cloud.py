"""Команда запуска на бесплатном хостинге с применением миграций."""
import os

import uvicorn

from .config import settings
from .manage import migrate


if __name__ == "__main__":
    settings()
    migrate()
    uvicorn.run("server.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")),
                proxy_headers=True, access_log=False)
