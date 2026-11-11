"""Интеграционные проверки на отдельной PostgreSQL с именем базы *_test."""
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict

from server.config import settings
from server.mail import MailDeliveryError
from server.main import app
from server.manage import migrate

ORIGIN = "http://127.0.0.1:8000"
PASSWORD = "test-campus-password"
TEST_DATA = """
    TRUNCATE users, students, teachers, mentors, moderators, scholarship_holders,
        communities, community_members, posts, likes, follows, attachments,
        hashtags, post_hashtags, email_codes, sessions, auth_limits, events, event_tickets,
        microsoft_flows, microsoft_pending, microsoft_identities, event_organizers
    RESTART IDENTITY
"""


class PilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.url = os.environ.get("TEST_DATABASE_URL")
        if not cls.url or not conninfo_to_dict(cls.url).get("dbname", "").endswith("_test"):
            raise RuntimeError("Укажите TEST_DATABASE_URL с именем базы, оканчивающимся на _test.")
        cls.env = patch.dict(os.environ, DATABASE_URL=cls.url, APP_ENV="dev", APP_ORIGIN=ORIGIN,
                             APP_SECRET="integration-test-secret-local-only", MAIL_MODE="file", AUTH_MODE="code",
                             CAMPUS_SHARE_PASSWORD="", CAMPUS_LOOPBACK_ORIGIN="")
        cls.env.start()
        cls.addClassCleanup(cls.env.stop)
        settings.cache_clear()
        cls.addClassCleanup(settings.cache_clear)
        migrate()
        with psycopg.connect(cls.url) as db:
            if not db.execute("SELECT current_database()").fetchone()[0].endswith("_test"):
                raise RuntimeError("Сервер подключил базу без суффикса _test.")

    def setUp(self):
        self.clear()
        self.addCleanup(self.clear)
        self.client = TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN})
        self.enterContext(self.client)
        self.mail = {}
        self.enterContext(patch("server.auth.send_code", side_effect=self.mail.__setitem__))

    def clear(self):
        with psycopg.connect(self.url) as db:
            db.execute(TEST_DATA)

    def registration(self, client, name):
        email = f"{name}@kbtu.kz"
        response = client.post("/api/auth/code", json={"email": email.upper()})
        self.assertEqual(response.status_code, 204, response.text)
        return {"email": email, "code": self.mail[email], "username": name,
                "password": PASSWORD, "first": "Тест", "last": name,
                "faculty": client.get("/api/auth/faculties").json()[0]["faculty_id"], "year": 1}

    def register(self, client, name):
        response = client.post("/api/auth/register", json=self.registration(client, name))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["user_id"]

    def microsoft(self, email):
        tenant = str(uuid4())
        self.enterContext(patch.dict(os.environ, AUTH_MODE="microsoft", MS_LOGIN_TENANT_ID=tenant,
                                     MS_LOGIN_CLIENT_ID=str(uuid4()), MS_LOGIN_CLIENT_SECRET="test-only"))
        settings.cache_clear()
        self.addCleanup(settings.cache_clear)
        provider = self.enterContext(patch("server.microsoft.login_client")).return_value
        provider.initiate_auth_code_flow.return_value = {
            "state": "test-state", "auth_uri": "https://login.microsoftonline.com/authorize",
        }
        return self.enterContext(patch("server.microsoft.exchange", return_value={
            "tid": tenant, "oid": str(uuid4()), "acct": 0, "preferred_username": email,
        }))

    def microsoft_start(self):
        response = self.client.get("/api/auth/microsoft/start", follow_redirects=False)
        self.assertEqual(response.headers["Location"], "https://login.microsoftonline.com/authorize")

    def microsoft_callback(self, state="test-state"):
        return self.client.get("/api/auth/microsoft/callback", follow_redirects=False,
                               params={"state": state, "code": "test-code"}).headers["Location"]

    def test_microsoft_signup_login_and_replay(self):
        exchange = self.microsoft("student@kbtu.kz")
        client = self.client
        self.assertEqual(client.get("/api/auth/options").json(),
                         {"microsoft": True, "code_signup": False, "domain_signup": False, "local_mail": False})
        self.assertEqual(client.post("/api/auth/code", json={"email": "student@kbtu.kz"}).status_code, 404)
        self.assertEqual(self.microsoft_callback(), "/?microsoft=failed")
        self.microsoft_start()
        self.assertEqual(self.microsoft_callback("wrong-state"), "/?microsoft=failed")
        exchange.assert_not_called()
        self.assertEqual(self.microsoft_callback(), "/?microsoft=profile")
        self.assertEqual(self.microsoft_callback(), "/?microsoft=failed")
        self.assertEqual(client.get("/api/auth/microsoft/profile").json()["email"], "student@kbtu.kz")
        data = {"username": "ms_student", "first": "Студент", "last": "КБТУ",
                "faculty": client.get("/api/auth/faculties").json()[0]["faculty_id"], "year": 1}
        invalid = client.post("/api/auth/microsoft/profile", json={**data, "faculty": 2147483647})
        self.assertEqual(invalid.status_code, 422)
        created = client.post("/api/auth/microsoft/profile", json=data)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(client.get("/api/auth/me").json()["username"], "ms_student")
        self.assertEqual(client.post("/api/auth/logout").status_code, 204)
        self.assertEqual(client.post("/api/auth/microsoft/profile", json=data).status_code, 401)
        self.assertEqual(client.post("/api/auth/login", json={"username": "ms_student", "password": PASSWORD}).status_code, 401)
        self.microsoft_start()
        self.assertEqual(self.microsoft_callback(), "/?microsoft=signed_in")
        self.assertEqual(client.get("/api/auth/me").json()["user_id"], created.json()["user_id"])

    def test_microsoft_guest_and_explicit_link(self):
        user_id = self.register(self.client, "existing")
        self.client.post("/api/auth/logout")
        exchange = self.microsoft("existing@kbtu.kz")
        self.microsoft_start()
        exchange.return_value["acct"] = 1
        self.assertEqual(self.microsoft_callback(), "/?microsoft=university")
        exchange.return_value["acct"] = 0
        self.microsoft_start()
        self.assertEqual(self.microsoft_callback(), "/?microsoft=existing")
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "existing", "password": PASSWORD}).status_code, 200)
        self.microsoft_start()
        self.assertEqual(self.microsoft_callback(), "/?microsoft=linked")
        self.client.post("/api/auth/logout")
        self.microsoft_start()
        self.assertEqual(self.microsoft_callback(), "/?microsoft=signed_in")
        self.assertEqual(self.client.get("/api/auth/me").json()["user_id"], user_id)

    def test_domain_registration_and_later_confirmation(self):
        self.addCleanup(settings.cache_clear)
        client = self.client
        login = {"username": "pilot_student", "password": PASSWORD}
        data = {**login, "first": "Студент", "last": "КБТУ",
                "faculty": client.get("/api/auth/faculties").json()[0]["faculty_id"], "year": 1}
        self.assertEqual(client.post("/api/auth/register-domain", json={**data, "email": "pilot@kbtu.kz"}).status_code, 404)
        with patch.dict(os.environ, AUTH_MODE="domain", MAIL_MODE="smtp", SMTP_PORT="invalid-unused-port"):
            settings.cache_clear()
            self.assertTrue(client.get("/api/auth/options").json()["domain_signup"])
            for address in ("pilot@gmail.com", "pilot@kbtu.kz.example", "pilot@other.kbtu.kz"):
                self.assertEqual(client.post("/api/auth/register-domain", json={**data, "email": address}).status_code, 422)
            self.assertEqual(client.post("/api/auth/code", json={"email": "pilot@kbtu.kz"}).status_code, 404)
            created = client.post("/api/auth/register-domain", json={**data, "email": "Pilot@KBTU.KZ"})
            self.assertEqual(created.status_code, 201, created.text)
            user_id = created.json()["user_id"]
            self.assertEqual(client.get("/api/auth/me").json()["user_id"], user_id)
            self.assertEqual(client.post("/api/auth/register-domain", json={**data, "email": "pilot@kbtu.kz"}).status_code, 409)
            self.assertEqual(self.mail, {})
            with psycopg.connect(self.url) as db:
                self.assertEqual(db.execute("SELECT email, email_verified_at FROM users WHERE user_id = %s",
                                            (user_id,)).fetchone(), ("pilot@kbtu.kz", None))
            client.post("/api/auth/logout")
            self.assertEqual(client.post("/api/auth/login", json=login).status_code, 200)
        settings.cache_clear()
        self.assertEqual(client.get("/api/auth/me").status_code, 401)
        self.assertEqual(client.post("/api/auth/login", json=login).status_code, 401)
        client.post("/api/auth/logout")
        proof = {**self.registration(client, "pilot"), **login}
        self.assertEqual(client.post("/api/auth/register", json={**proof, "password": "wrong-password"}).status_code, 400)
        confirmed = client.post("/api/auth/register", json=proof)
        self.assertEqual(confirmed.status_code, 201, confirmed.text)
        self.assertEqual(confirmed.json()["user_id"], user_id)
        self.assertEqual(client.get("/api/auth/me").status_code, 200)

    def test_temporary_link_requires_its_password(self):
        self.addCleanup(settings.cache_clear)
        with patch.dict(os.environ, APP_ENV="pilot", APP_ORIGIN="https://example.test",
                        AUTH_MODE="domain", CAMPUS_SHARE_PASSWORD="example-only-share-password"):
            settings.cache_clear()
            for path in ("/", "/assets/app.js", "/api/health", "/api/auth/options"):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)
                self.assertIn("Basic", response.headers["WWW-Authenticate"])
            self.assertEqual(self.client.get("/api/health", auth=("campus", "wrong")).status_code, 401)
            result = self.client.get("/api/health", auth=("campus", "example-only-share-password"))
            self.assertEqual(result.json(), {"status": "ok"})

    def test_registration_and_session(self):
        client = self.client
        self.assertEqual(client.get("/api/feed").status_code, 401)
        self.assertEqual(client.post("/api/auth/code", headers={"Origin": "https://other.example"},
                                     json={"email": "a@kbtu.kz"}).status_code, 403)
        self.assertEqual(client.post("/api/auth/code", json={"email": "a@kbtu.kz.example"}).status_code, 422)
        with patch("server.auth.send_code", side_effect=MailDeliveryError("HTTP 403")):
            failed = client.post("/api/auth/code", json={"email": "tester@kbtu.kz"})
        self.assertEqual(failed.status_code, 503)
        data = self.registration(client, "tester")
        self.assertEqual(client.post("/api/auth/code", json={"email": data["email"]}).status_code, 429)
        wrong = "000000" if data["code"] != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(client.post("/api/auth/register", json={**data, "code": wrong}).status_code, 400)
        self.assertEqual(client.post("/api/auth/register", json=data).status_code, 400)
        expired = self.registration(client, "expired")
        with psycopg.connect(self.url) as db:
            db.execute("UPDATE email_codes SET expires_at = now() WHERE email = %s", (expired["email"],))
        self.assertEqual(client.post("/api/auth/register", json=expired).status_code, 400)
        data = self.registration(client, "verified")
        response = client.post("/api/auth/register", json=data)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        self.assertNotIn("password_hash", response.json())
        self.assertNotIn("email", response.json())
        self.assertEqual(client.post("/api/auth/register", json=data).status_code, 400)
        self.assertEqual(client.get("/api/auth/me").json()["username"], "verified")
        self.assertEqual(client.post("/api/auth/logout").status_code, 204)
        self.assertEqual(client.get("/api/auth/me").status_code, 401)
        self.assertEqual(client.post("/api/auth/login", json={"username": "verified", "password": "wrong"}).status_code, 401)
        self.assertEqual(client.post("/api/auth/login", json={"username": "verified", "password": PASSWORD}).status_code, 200)

    def test_social_and_last_seat(self):
        first = self.client
        second = TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN})
        self.addCleanup(second.close)
        owner_id = self.register(first, "author")
        self.register(second, "reader")
        self.assertEqual(first.get("/api/feed").json(), [])
        created = first.post("/api/communities", json={"name": "Клуб"})
        self.assertEqual(created.status_code, 201, created.text)
        community_id = created.json()["community_id"]
        self.assertEqual(second.post("/api/communities", json={"name": "Клуб"}).status_code, 409)
        self.assertTrue(first.get("/api/communities", params={"joined": True}).json()[0]["joined"])
        with psycopg.connect(self.url) as db:
            self.assertEqual(db.execute("""
                SELECT role FROM community_members WHERE user_id = %s AND community_id = %s
            """, (owner_id, community_id)).fetchone()[0], "admin")
            future = db.execute("SELECT (now() AT TIME ZONE 'Asia/Almaty') + interval '1 day'").fetchone()[0]
        event = {"title": "Открытая лекция", "venue": "KBTU", "starts_at": future.isoformat(), "capacity": 1}
        self.assertEqual(first.get("/api/events").headers["X-Can-Create-Event"], "0")
        self.assertEqual(first.post("/api/events", json=event).status_code, 403)
        with psycopg.connect(self.url) as db:
            self.assertFalse(db.execute("SELECT campus_api.grant_event_organizer('absent')").fetchone()[0])
            self.assertTrue(db.execute("SELECT campus_api.grant_event_organizer('author')").fetchone()[0])
            self.assertTrue(db.execute("SELECT campus_api.grant_event_organizer('author')").fetchone()[0])
        self.assertEqual(first.get("/api/events").headers["X-Can-Create-Event"], "1")
        self.assertEqual(second.post("/api/events", json=event).status_code, 403)
        self.assertEqual(first.post("/api/events", json={**event, "starts_at": "2000-01-01T00:00"}).status_code, 422)
        event_created = first.post("/api/events", json=event)
        self.assertEqual(event_created.status_code, 201, event_created.text)
        event_id = event_created.json()["event_id"]
        with psycopg.connect(self.url) as db:
            self.assertEqual(db.execute("SELECT organizer_id FROM events WHERE event_id = %s",
                                        (event_id,)).fetchone()[0], owner_id)
        post = {"content": "Привет #Сессия 100%", "anonymous": True, "community": community_id}
        self.assertEqual(second.post("/api/posts", json=post).status_code, 403)
        self.assertEqual(second.put(f"/api/communities/{community_id}/membership", json={"enabled": True}).status_code, 204)
        response = first.post("/api/posts", json=post)
        self.assertEqual(response.status_code, 201, response.text)
        post_id = response.json()["post_id"]
        self.assertEqual(second.get(f"/api/communities/{community_id}").json()["posts"][0]["post_id"], post_id)
        visible = second.get("/api/feed").json()[0]
        self.assertIsNone(visible["author_id"])
        self.assertIsNone(visible["full_name"])
        self.assertFalse(visible["mine"])
        self.assertEqual(second.get(f"/api/users/{owner_id}").json()["profile"]["posts"], 0)
        self.assertEqual(second.get(f"/api/users/{owner_id}").json()["posts"], [])
        self.assertEqual(second.get("/api/search", params={"tag": "сессия"}).json()["posts"][0]["post_id"], post_id)
        self.assertEqual(second.get("/api/search", params={"term": "100%"}).json()["posts"][0]["post_id"], post_id)
        self.assertEqual(second.get("/api/search").json()["tags"][0]["tag"], "сессия")
        self.assertEqual(second.put(f"/api/users/{owner_id}/follow", json={"enabled": True}).status_code, 204)
        self.assertEqual(second.get("/api/feed", params={"following": True}).json()[0]["post_id"], post_id)
        reply = second.post("/api/posts", json={"content": "Ответ", "parent": post_id})
        self.assertEqual(reply.json()["community_id"], community_id)
        self.assertEqual(second.get(f"/api/posts/{post_id}").json()[1]["content"], "Ответ")
        self.assertEqual(second.put(f"/api/posts/{post_id}/like", json={"enabled": True}).json()["like_count"], 1)
        self.assertEqual(second.put(f"/api/posts/{post_id}/like", json={"enabled": True}).json()["like_count"], 1)
        self.assertEqual(second.delete(f"/api/posts/{post_id}").status_code, 404)
        self.assertEqual(first.delete(f"/api/posts/{post_id}").status_code, 204)
        self.assertEqual(first.get(f"/api/posts/{post_id}").status_code, 404)

        url = f"/api/events/{event_id}/ticket"
        with ThreadPoolExecutor(2) as workers:
            results = list(workers.map(lambda c: c.post(url), (first, second)))
        self.assertEqual(sorted(r.status_code for r in results), [200, 409])
        winner, other = (first, second) if results[0].status_code == 200 else (second, first)
        ticket = winner.get("/api/tickets").json()[0]["ticket_id"]
        self.assertEqual(winner.post(url).json()["ticket_id"], ticket)
        self.assertEqual(other.get("/api/tickets").json(), [])
        self.assertEqual(other.get("/api/events").json()[0]["available"], 0)

    def test_moderator_can_delete_only_with_current_permissions(self):
        author = self.client
        moderator = TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN})
        self.addCleanup(moderator.close)
        self.register(author, "writer")
        moderator_id = self.register(moderator, "helper")
        community = author.post("/api/communities", json={"name": "Клуб"}).json()["community_id"]
        inside = author.post("/api/posts", json={"content": "В клубе #клуб", "community": community}).json()["post_id"]
        outside = author.post("/api/posts", json={"content": "Общий тред"}).json()["post_id"]
        after_revoke = author.post("/api/posts", json={"content": "Новый тред"}).json()["post_id"]

        def change(username, enabled, name=None):
            with psycopg.connect(self.url) as db:
                return db.execute("SELECT campus_api.change_moderator(%s, %s, %s)",
                                  (username, enabled, name)).fetchone()[0]

        self.assertEqual(change("helper", True, "Клуб"), "not_member")
        self.assertEqual(change("writer", False, "Клуб"), "admin")
        self.assertFalse(moderator.get(f"/api/posts/{inside}").json()[0]["can_delete"])
        self.assertEqual(moderator.put(f"/api/communities/{community}/membership",
                                       json={"enabled": True}).status_code, 204)
        self.assertEqual(change("helper", True, "Клуб"), "ok")
        self.assertTrue(moderator.get(f"/api/posts/{inside}").json()[0]["can_delete"])
        self.assertTrue(moderator.get("/api/search", params={"tag": "клуб"}).json()["posts"][0]["can_delete"])
        self.assertEqual(moderator.delete(f"/api/posts/{outside}").status_code, 404)
        self.assertEqual(change("helper", False, "Клуб"), "ok")
        self.assertEqual(moderator.delete(f"/api/posts/{inside}").status_code, 404)
        with psycopg.connect(self.url) as db:
            self.assertEqual(db.execute("""
                SELECT role FROM community_members WHERE user_id = %s AND community_id = %s
            """, (moderator_id, community)).fetchone()[0], "member")

        self.assertEqual(change("helper", True), "ok")
        self.assertTrue(moderator.get(f"/api/posts/{outside}").json()[0]["can_delete"])
        self.assertEqual(moderator.delete(f"/api/posts/{outside}").status_code, 204)
        self.assertEqual(moderator.delete(f"/api/posts/{inside}").status_code, 204)
        self.assertEqual(change("helper", False), "ok")
        self.assertFalse(moderator.get(f"/api/posts/{after_revoke}").json()[0]["can_delete"])
        self.assertEqual(moderator.delete(f"/api/posts/{after_revoke}").status_code, 404)

    def test_pagination_with_equal_timestamps_and_removed_cursor(self):
        viewer = self.register(self.client, "pager")
        with psycopg.connect(self.url) as db:
            post_ids = [row[0] for row in db.execute("""
                INSERT INTO posts (author_id, content, created_at)
                SELECT %s, 'Страница ' || n, now() AT TIME ZONE 'UTC'
                FROM generate_series(1, 4) n RETURNING post_id
            """, (viewer,))]
            event_ids = [row[0] for row in db.execute("""
                INSERT INTO events (title, venue, starts_at, capacity)
                SELECT 'Афиша ' || n, 'KBTU', now() + interval '1 day', 1
                FROM generate_series(1, 3) n RETURNING event_id
            """)]

        first = self.client.get("/api/feed", params={"page_size": 2})
        self.assertEqual([row["post_id"] for row in first.json()], list(reversed(post_ids[2:])))
        with psycopg.connect(self.url) as db:
            db.execute("DELETE FROM posts WHERE post_id = %s", (post_ids[2],))
            db.execute("INSERT INTO posts (author_id, content) VALUES (%s, 'Новый тред')", (viewer,))
        second = self.client.get("/api/feed", params={"page_size": 2, "after": first.headers["X-Next-Cursor"]})
        self.assertEqual([row["post_id"] for row in second.json()], list(reversed(post_ids[:2])))
        self.assertNotIn("X-Next-Cursor", second.headers)
        self.assertEqual(self.client.get("/api/feed", params={"after": "не курсор"}).status_code, 422)

        first = self.client.get("/api/events", params={"page_size": 2})
        self.assertEqual([row["event_id"] for row in first.json()], event_ids[:2])
        last = self.client.get("/api/events", params={"page_size": 2, "after": first.headers["X-Next-Cursor"]})
        self.assertEqual([row["event_id"] for row in last.json()], event_ids[2:])
        self.assertNotIn("X-Next-Cursor", last.headers)
