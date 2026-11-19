"""Отдельная PostgreSQL *_test и настоящий HTTP-сервер для UI и нагрузочных тестов."""
import argparse
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bcrypt
import psycopg
import uvicorn
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from server.config import ROOT, database_url
from server.manage import migrate


def prepare(port, users, empty_events=False):
    url = os.getenv("TEST_DATABASE_URL") or make_conninfo(database_url(), dbname="campus_threads_test")
    if not conninfo_to_dict(url).get("dbname", "").endswith("_test"):
        raise RuntimeError("TEST_DATABASE_URL должен указывать на базу *_test.")
    os.environ.update(DATABASE_URL=url, APP_ENV="dev", AUTH_MODE="domain",
                      APP_ORIGIN=f"http://127.0.0.1:{port}", CAMPUS_LOOPBACK_ORIGIN="")
    migrate()
    password = "Front-test-password"
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    fixtures = {"origin": os.environ["APP_ORIGIN"], "password": password, "users": []}
    with psycopg.connect(url) as db:
        tables = [name for name, in db.execute("""
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
            AND tablename NOT IN ('campus_migrations', 'faculties')
        """)]
        from psycopg import sql
        db.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY").format(
            sql.SQL(", ").join(sql.Identifier("public", name) for name in tables)))
        faculty, = db.execute("SELECT faculty_id FROM faculties ORDER BY faculty_id LIMIT 1").fetchone()
        fixtures["faculty"] = faculty
        for index in range(users):
            username = f"front_{index}"
            user_id = db.execute("""
                SELECT user_id FROM campus_api.create_domain_student(%s, %s, %s, %s, %s, 2, %s)
            """, (username, f"{username}@kbtu.kz", password_hash,
                  "Айдана" if index == 0 else "Студент", "КБТУ", faculty)).fetchone()[0]
            token = secrets.token_urlsafe(32)
            db.execute("CALL campus_api.create_session(%s, %s)", (hashlib.sha256(token.encode()).hexdigest(), user_id))
            fixtures["users"].append({"username": username, "user_id": user_id, "session": token})
        first = fixtures["users"][0]["user_id"]
        db.execute("SELECT campus_api.grant_event_organizer('front_0')")
        if users > 2:
            db.execute("SELECT campus_api.change_moderator('front_2', TRUE)")
        community = db.execute("SELECT campus_api.create_community(%s, 'Клуб разработки', 'Встречи и проекты')",
                               (first,)).fetchone()[0]
        fixtures["community"] = community
        db.execute("""
            INSERT INTO posts (author_id, content, created_at)
            SELECT %s, 'Обсуждение проекта ' || n, now() AT TIME ZONE 'UTC' - n * interval '1 minute'
            FROM generate_series(1, 35) n
        """, (first,))
        fixtures["post"] = db.execute("SELECT post_id FROM posts ORDER BY created_at DESC LIMIT 1").fetchone()[0]
        event_id = None if empty_events else db.execute("""
            INSERT INTO events (title, description, venue, starts_at, capacity, organizer_id)
            VALUES ('Встреча разработчиков', 'Обсуждаем студенческие проекты', 'КБТУ · 201',
                    now() + interval '2 days', 1, %s) RETURNING event_id
        """, (first,)).fetchone()[0]
        fixtures["event"] = event_id
    output = ROOT / ".runtime" / "test-fixtures.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(fixtures, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--empty-events", action="store_true")
    args = parser.parse_args()
    prepare(args.port, args.users, args.empty_events)
    uvicorn.run("server.main:app", host="127.0.0.1", port=args.port, access_log=False)
