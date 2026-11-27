from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, NaiveDatetime, StringConstraints

from .auth import User
from .db import Db
from .images import prepare_photo
from .pagination import Pagination
from .social import Id

router = APIRouter(prefix="/api", tags=["Мероприятия"])


def event_permissions(db, user_id, response):
    permissions = db.execute("SELECT campus_api.can_create_event(%s) AS allowed", (user_id,)).fetchone()
    response.headers["X-Can-Create-Event"] = "1" if permissions["allowed"] else "0"


class EventInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)] = ""
    venue: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    starts_at: NaiveDatetime
    capacity: int = Field(ge=1, le=2147483647)
    cover: str | None = Field(None, max_length=280_000)


class CheckIn(BaseModel):
    ticket_id: UUID


@router.get("/events")
def events(db: Db, user: User, page: Pagination, response: Response, archive: bool = False):
    user_id = user["user_id"]
    event_permissions(db, user_id, response)
    rows = db.execute(
        "SELECT * FROM campus_api.event_cards(%s, %s, %s, %s, %s)",
        (user_id, archive, page.size + 1, *page.position),
    ).fetchall()
    return page.finish(rows, "starts_at", "event_id")


@router.post("/events", status_code=201)
def create_event(body: EventInput, db: Db, user: User):
    cover = prepare_photo(body.cover, "Не удалось обработать фото мероприятия.") if body.cover is not None else None
    with db.transaction():
        result = db.execute(
            "SELECT * FROM campus_api.create_event(%s, %s, %s, %s, %s, %s)",
            (user["user_id"], body.title, body.description, body.venue, body.starts_at, body.capacity),
        ).fetchone()
        if result["outcome"] == "ok" and cover is not None:
            db.execute("UPDATE public.events SET cover_jpeg = %s WHERE event_id = %s", (cover, result["event_id"]))
    if result["outcome"] == "forbidden":
        raise HTTPException(403, "Публиковать мероприятия могут организаторы и модераторы сайта.")
    if result["outcome"] == "past":
        raise HTTPException(422, "Выберите дату и время в будущем.")
    return {"event_id": result["event_id"]}


@router.get("/events/{event_id}")
def event_details(event_id: Id, db: Db, user: User):
    row = db.execute("SELECT * FROM campus_api.event_cards(%s, FALSE, 1, NULL, NULL, %s)",
                     (user["user_id"], event_id)).fetchone()
    if row is None:
        raise HTTPException(404, "Мероприятие не найдено.")
    return row


@router.get("/events/{event_id}/cover", response_class=Response)
def event_cover(event_id: Id, db: Db, user: User):
    row = db.execute("SELECT cover_jpeg FROM public.events WHERE event_id = %s", (event_id,)).fetchone()
    if row is None or row["cover_jpeg"] is None:
        raise HTTPException(404, "Фото не найдено.")
    return Response(row["cover_jpeg"], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})


@router.post("/events/{event_id}/check-in")
def check_in(event_id: Id, body: CheckIn, db: Db, user: User):
    outcome = db.execute("SELECT campus_api.check_in_ticket(%s, %s, %s) AS outcome",
                         (user["user_id"], event_id, body.ticket_id)).fetchone()["outcome"]
    if outcome == "missing":
        raise HTTPException(404, "Мероприятие или пропуск не найдены.")
    if outcome == "forbidden":
        raise HTTPException(403, "У вас нет права отмечать посещение этого мероприятия.")
    if outcome == "too_early":
        raise HTTPException(409, "Отметка посещения доступна после начала мероприятия.")
    return {"already_checked_in": outcome == "already_checked_in"}


@router.get("/tickets")
def tickets(db: Db, user: User, response: Response):
    event_permissions(db, user["user_id"], response)
    return db.execute("SELECT * FROM campus_api.my_tickets(%s)", (user["user_id"],)).fetchall()


@router.post("/events/{event_id}/ticket")
def issue_ticket(event_id: Id, db: Db, user: User):
    ticket = db.execute("SELECT * FROM campus_api.issue_ticket(%s, %s)",
                        (user["user_id"], event_id)).fetchone()
    outcome = ticket["outcome"]
    if outcome == "missing":
        raise HTTPException(404, "Мероприятие не найдено.")
    if outcome == "closed":
        raise HTTPException(409, "Регистрация закрыта, мероприятие уже началось.")
    if outcome == "full":
        raise HTTPException(409, "Свободных мест больше нет.")
    return {"ticket_id": ticket["ticket_id"]}
