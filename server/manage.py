"""SQL-миграции: вручную для разработки, автоматически при облачном запуске."""
import argparse

import psycopg

from .config import ROOT, database_url
from .db import MIGRATION_VERSION

SQL_ROUTINES = (
    "server/sql/posts.sql", "server/sql/people.sql",
    "server/sql/events.sql", "server/sql/accounts.sql",
)
MIGRATIONS = (
    (1, "site/sql/01_schema.sql", "site/sql/03_views_triggers.sql"),
    (2, "server/schema/02_pilot.sql", "server/schema/faculties.sql"),
    (3, "server/schema/03_api.sql", *SQL_ROUTINES),
    (4, "server/schema/04_microsoft.sql", "server/sql/microsoft.sql"),
    (5, "server/schema/05_domain_registration.sql", "server/sql/domain_registration.sql"),
    (6, "server/schema/06_organizers.sql", "server/sql/organizers.sql"),
    (7, "server/sql/moderation.sql"),
    (8, "server/schema/08_remove_email_codes.sql"),
    (9, "server/schema/09_moderator_events.sql"),
    (10, "server/schema/10_campus_dashboard.sql"),
    (11, "server/schema/11_profile_photos.sql"),
)


def migrate():
    with psycopg.connect(database_url(), connect_timeout=5) as db:
        db.execute("SELECT pg_advisory_xact_lock(658941034)")
        name, initialized = db.execute("""
            SELECT current_database(), to_regclass('public.campus_migrations') IS NOT NULL
        """).fetchone()
        if not initialized and db.execute("""
            SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1
        """).fetchone():
            raise RuntimeError(f"В {name} уже есть таблицы. Создайте отдельную базу для пилота.")
        db.execute("SET LOCAL search_path TO public")
        db.execute("""
            CREATE TABLE IF NOT EXISTS campus_migrations (version INT PRIMARY KEY)
        """)
        applied = {row[0] for row in db.execute("SELECT version FROM campus_migrations")}
        if not applied.issubset(range(1, MIGRATION_VERSION + 1)):
            raise RuntimeError("Версия базы новее версии сервера.")
        for version, *files in MIGRATIONS:
            if version not in applied:
                for file in files:
                    db.execute((ROOT / file).read_text(encoding="utf-8"))
                db.execute("INSERT INTO campus_migrations VALUES (%s)", (version,))
    print(f"База {name} готова. Версия схемы {MIGRATION_VERSION}.")


def grant_event_organizer(username):
    username = username.strip().removeprefix("@").lower()
    with psycopg.connect(database_url(), connect_timeout=5) as db:
        found, = db.execute("SELECT campus_api.grant_event_organizer(%s)",
                            (username,)).fetchone()
    if not found:
        raise ValueError("Аккаунт с таким именем не найден. Сначала зарегистрируйся на сайте.")
    print(f"Роль организатора включена для @{username}. Открой «Мероприятия» на сайте.")


def change_moderator(username, enabled, community=None):
    username = username.strip().removeprefix("@").lower()
    if community is not None:
        community = community.strip()
    with psycopg.connect(database_url(), connect_timeout=5) as db:
        outcome, = db.execute("SELECT campus_api.change_moderator(%s, %s, %s)",
                              (username, enabled, community)).fetchone()
    errors = {
        "user_missing": "Аккаунт с таким именем не найден.",
        "community_missing": "Сообщество с таким названием не найдено.",
        "not_member": "Пользователю нужно сначала вступить в сообщество.",
        "admin": "Пользователь уже администратор этого сообщества. Его роль сохранена.",
    }
    if outcome != "ok":
        raise ValueError(errors[outcome])
    role = f"модератора сообщества «{community}»" if community else "модератора сайта"
    action = "выдана" if enabled else "снята"
    print(f"Роль {role} {action} для @{username}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["migrate", "organizer", "grant-moderator", "revoke-moderator"])
    parser.add_argument("username", nargs="?")
    parser.add_argument("--community", help="Точное название сообщества")
    args = parser.parse_args()
    if args.command == "migrate":
        migrate()
    else:
        if not args.username:
            parser.error("Укажи имя пользователя Campus Threads.")
        try:
            if args.command == "organizer":
                grant_event_organizer(args.username)
            else:
                change_moderator(args.username, args.command == "grant-moderator", args.community)
        except ValueError as error:
            parser.error(str(error))
