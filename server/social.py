import re
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query
from psycopg import Error
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field, StringConstraints

from .auth import User
from .db import Db
from .pagination import Pagination

router = APIRouter(prefix="/api", tags=["Соцсеть"])
Id = Annotated[int, Path(gt=0, le=2147483647)]


class Toggle(BaseModel):
    enabled: bool


class PostInput(BaseModel):
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    community: int | None = Field(default=None, gt=0, le=2147483647)
    parent: int | None = Field(default=None, gt=0, le=2147483647)
    anonymous: bool = False


class BioInput(BaseModel):
    bio: str = Field(max_length=160)


class CommunityInput(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""


def add_delete_permissions(db, user_id, posts):
    if posts:
        rights = db.execute("SELECT * FROM campus_api.post_moderation(%s)", (user_id,)).fetchone()
        moderated = set(rights["community_ids"])
        for post in posts:
            post["can_delete"] = post["mine"] or rights["site_wide"] or post["community_id"] in moderated
    return posts


@router.get("/feed")
def feed(db: Db, user: User, page: Pagination, following: bool = False):
    rows = db.execute(
        "SELECT * FROM campus_api.feed_page(%s, %s, %s, %s, %s)",
        (user["user_id"], following, page.size + 1, *page.position),
    ).fetchall()
    return add_delete_permissions(db, user["user_id"], page.finish(rows, "created_at", "post_id"))


@router.get("/posts/{post_id}")
def thread(post_id: Id, db: Db, user: User):
    rows = db.execute("SELECT depth, (card).* FROM campus_api.read_thread(%s, %s)",
                      (user["user_id"], post_id)).fetchall()
    if not rows:
        raise HTTPException(404, "Тред не найден.")
    return add_delete_permissions(db, user["user_id"], rows)


@router.post("/posts", status_code=201)
def publish(body: PostInput, db: Db, user: User):
    tags = sorted(set(re.findall(r"#([a-zа-яё0-9_]+)", body.content.lower())))
    if any(len(tag) > 50 for tag in tags):
        raise HTTPException(422, "Хэштег может содержать до 50 символов.")
    if body.parent and body.community:
        raise HTTPException(422, "Сообщество ответа определяется по исходному треду.")
    post = db.execute(
        "SELECT * FROM campus_api.publish_post(%s, %s, %s, %s, %s, %s::text[])",
        (user["user_id"], body.community, body.parent, body.content, body.anonymous, tags),
    ).fetchone()
    if not post:
        raise HTTPException(403, "Вступите в сообщество перед публикацией.")
    return post


@router.delete("/posts/{post_id}", status_code=204)
def delete(post_id: Id, db: Db, user: User):
    result = db.execute("SELECT campus_api.delete_post(%s, %s) AS deleted",
                        (user["user_id"], post_id)).fetchone()
    if not result["deleted"]:
        raise HTTPException(404, "Тред недоступен для удаления.")


@router.put("/posts/{post_id}/like")
def like(post_id: Id, body: Toggle, db: Db, user: User):
    row = db.execute("SELECT * FROM campus_api.set_like(%s, %s, %s)",
                     (user["user_id"], post_id, body.enabled)).fetchone()
    if not row:
        raise HTTPException(404, "Тред не найден.")
    return row


@router.get("/users/{user_id}")
def profile(user_id: Id, db: Db, user: User):
    args = (user["user_id"], user_id)
    person = db.execute("SELECT * FROM campus_api.read_profile(%s, %s)", args).fetchone()
    if not person:
        raise HTTPException(404, "Пользователь не найден.")
    posts = db.execute("SELECT * FROM campus_api.profile_posts(%s, %s)", args).fetchall()
    return {"profile": person, "posts": add_delete_permissions(db, user["user_id"], posts)}


@router.patch("/me/bio", status_code=204)
def bio(body: BioInput, db: Db, user: User):
    db.execute("CALL campus_api.update_bio(%s, %s)", (user["user_id"], body.bio.strip()))


@router.put("/users/{user_id}/follow", status_code=204)
def follow(user_id: Id, body: Toggle, db: Db, user: User):
    viewer = user["user_id"]
    if viewer == user_id:
        raise HTTPException(422, "Нельзя подписаться на себя.")
    db.execute("CALL campus_api.set_follow(%s, %s, %s)", (viewer, user_id, body.enabled))


@router.get("/communities")
def communities(db: Db, user: User, joined: bool = False):
    return db.execute("SELECT * FROM campus_api.list_communities(%s, %s)",
                      (user["user_id"], joined)).fetchall()


@router.post("/communities", status_code=201)
def create_community(body: CommunityInput, db: Db, user: User):
    try:
        return db.execute("SELECT campus_api.create_community(%s, %s, %s) AS community_id",
                          (user["user_id"], body.name, body.description)).fetchone()
    except UniqueViolation as error:
        if error.diag.constraint_name == "communities_name_key":
            raise HTTPException(409, "Сообщество с таким названием уже есть.") from None
        raise


@router.get("/communities/{community_id}")
def community(community_id: Id, db: Db, user: User):
    args = (user["user_id"], community_id)
    group = db.execute("SELECT * FROM campus_api.list_communities(%s, FALSE, %s)", args).fetchone()
    if not group:
        raise HTTPException(404, "Сообщество не найдено.")
    posts = db.execute("SELECT * FROM campus_api.community_posts(%s, %s)", args).fetchall()
    return {"community": group, "posts": add_delete_permissions(db, user["user_id"], posts)}


@router.put("/communities/{community_id}/membership", status_code=204)
def membership(community_id: Id, body: Toggle, db: Db, user: User):
    try:
        db.execute("CALL campus_api.set_membership(%s, %s, %s)", (user["user_id"], community_id, body.enabled))
    except Error as error:
        if error.sqlstate == 'CT001':
            raise HTTPException(409, "Последний администратор не может покинуть сообщество.") from None
        raise


@router.get("/search")
def search(db: Db, user: User, term: str = Query("", max_length=100), tag: str = Query("", max_length=50)):
    term = term.strip()
    tag = tag.strip().removeprefix('#').lower()
    if not tag and re.fullmatch(r"#[a-zа-яё0-9_]{1,50}", term.lower()):
        term, tag = '', term[1:].lower()
    result = db.execute("SELECT campus_api.search(%s, %s, %s) AS result",
                        (user["user_id"], term, tag)).fetchone()["result"]
    if "posts" in result:
        add_delete_permissions(db, user["user_id"], result["posts"])
    if term and not tag:
        result.update(db.execute("SELECT campus_api.search_catalog(%s) AS result", (term,)).fetchone()["result"])
    return result


@router.get("/analytics")
def analytics(db: Db, user: User):
    if not user['site_moderator']:
        raise HTTPException(403, "Сводка доступна модераторам сайта.")
    return db.execute("SELECT * FROM campus_api.live_summary").fetchone()
