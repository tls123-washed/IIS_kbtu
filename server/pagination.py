from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Response


class Page:
    def __init__(
        self, response: Response, page_size: int = Query(30, ge=1, le=50),
        after: str | None = Query(None, max_length=100),
    ):
        self.response = response
        self.size = page_size
        self.position = (None, None)
        if after is not None:
            try:
                timestamp, row_id = after.split("|", 1)
                instant = datetime.fromisoformat(timestamp)
                key = int(row_id)
                if instant.tzinfo is None or not 1 <= key <= 2147483647:
                    raise ValueError
                self.position = (instant.astimezone(timezone.utc), key)
            except (ValueError, OverflowError):
                raise HTTPException(422, "Курсор страницы недействителен.") from None

    def finish(self, rows, time_key, id_key):
        if len(rows) > self.size:
            # Лишняя строка показывает, что есть следующая страница.
            last = rows[self.size - 1]
            self.response.headers["X-Next-Cursor"] = f"{last[time_key].isoformat()}|{last[id_key]}"
        return rows[:self.size]


Pagination = Annotated[Page, Depends()]
