"""Запуск сайта на Windows и управление временной ссылкой с этого ПК."""
import argparse
import json
import msvcrt
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from contextlib import contextmanager
from pathlib import Path
from threading import Event, Thread
from urllib.error import URLError
from urllib.request import urlopen
from uuid import uuid4

import uvicorn
from psycopg import Error as DatabaseError
from psycopg.conninfo import conninfo_to_dict

from .config import ROOT, database_url
from .manage import change_moderator, grant_event_organizer, migrate

RUNTIME = ROOT / ".runtime"
LOCK = RUNTIME / "site.lock"
STATE = RUNTIME / "site.json"
STOP = RUNTIME / "stop.txt"
LOG = RUNTIME / "site.log"
TUNNEL_LOG = RUNTIME / "tunnel.log"
PUBLIC_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com\b")
LOOPBACK = "127.0.0.1"


class LauncherError(Exception):
    pass


@contextmanager
def site_lock():
    RUNTIME.mkdir(exist_ok=True)
    with LOCK.open("a+b") as lock:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def site_status():
    try:
        with site_lock():
            return None
    except PermissionError:
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"url": "", "mode": "starting", "id": ""}


def ready(url):
    try:
        with urlopen(url + "/api/health", timeout=1) as response:
            return json.load(response) == {"status": "ok"}
    except (OSError, URLError, ValueError):
        return False


def start_database():
    database = conninfo_to_dict(database_url())
    data = ROOT / ".local-pg" / "data"
    if (database.get("host"), database.get("port")) != (LOOPBACK, "55432") or not (data / "PG_VERSION").exists():
        return
    binaries = Path(os.getenv("CAMPUS_PG_BIN", r"D:\PostgreSQL\bin"))
    status = subprocess.run(
        [str(binaries / "pg_isready.exe"), "-h", LOOPBACK, "-p", "55432", "-t", "2"],
        stdout=subprocess.DEVNULL,
    )
    if status.returncode:
        subprocess.run([
            str(binaries / "pg_ctl.exe"), "start", "-D", str(data),
            "-l", str(ROOT / ".local-pg" / "postgres.log"), "-w", "-t", "15",
        ], check=True)


def open_socket():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind((LOOPBACK, 8000))
        except OSError as error:
            if error.winerror != 10048:
                raise
            listener.bind((LOOPBACK, 0))
    except BaseException:
        listener.close()
        raise
    return listener


def cloudflared_path():
    bundled = RUNTIME / "cloudflared.exe"
    program = str(bundled) if bundled.is_file() else shutil.which("cloudflared")
    if not program:
        raise LauncherError("Для ссылки из интернета нужен cloudflared.exe. См. README.")
    return program


def write_status(state):
    temporary = STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state), encoding="utf-8")
    temporary.replace(STATE)


def stop_requested(run_id):
    try:
        return STOP.read_text(encoding="utf-8") == run_id
    except FileNotFoundError:
        return False


def public_address(tunnel, run_id):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and tunnel.poll() is None:
        if stop_requested(run_id):
            return None
        match = PUBLIC_URL.search(TUNNEL_LOG.read_text(encoding="utf-8", errors="replace"))
        if match:
            return match.group()
        time.sleep(0.25)
    raise LauncherError(f"Cloudflare не выдал ссылку. Журнал: {TUNNEL_LOG}")


def terminate_tunnel(tunnel):
    if tunnel and tunnel.poll() is None:
        tunnel.terminate()
        try:
            tunnel.wait(timeout=5)
        except subprocess.TimeoutExpired:
            tunnel.kill()
            tunnel.wait()


def serve(mode):
    with site_lock(), open_socket() as listener:
        STOP.unlink(missing_ok=True)
        port = listener.getsockname()[1]
        local_url = f"http://{LOOPBACK}:{port}"
        run_id = uuid4().hex
        state = {"id": run_id, "mode": mode, "url": "", "local_url": local_url}
        write_status(state)
        tunnel = None
        done = Event()
        try:
            start_database()
            migrate()
            if stop_requested(run_id):
                return
            public = mode == "public"
            address = local_url
            if public:
                with TUNNEL_LOG.open("w", encoding="utf-8") as log:
                    tunnel = subprocess.Popen([
                        cloudflared_path(), "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", local_url,
                    ], stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
                address = public_address(tunnel, run_id)
                if address is None:
                    return
            os.environ.update(APP_ENV="pilot" if public else "dev", APP_ORIGIN=address,
                              CAMPUS_LOOPBACK_ORIGIN=local_url if public else "")
            server = uvicorn.Server(uvicorn.Config(
                "server.main:app", host=LOOPBACK, port=port, access_log=False,
                proxy_headers=public, forwarded_allow_ips=LOOPBACK, timeout_graceful_shutdown=5,
            ))

            def wait_for_stop():
                while not done.wait(0.25):
                    if stop_requested(run_id) or (tunnel and tunnel.poll() is not None):
                        server.should_exit = True
                        return

            state["url"] = address
            write_status(state)
            Thread(target=wait_for_stop, daemon=True).start()
            server.run(sockets=[listener])
        finally:
            done.set()
            terminate_tunnel(tunnel)
            STATE.unlink(missing_ok=True)


def stop():
    state = site_status()
    if not state:
        print("Campus Threads остановлен.")
        return
    if not state["id"]:
        raise LauncherError("Campus Threads запускается. Повтори остановку через несколько секунд.")
    STOP.write_text(state["id"], encoding="utf-8")
    deadline = time.monotonic() + 10
    while site_status() and time.monotonic() < deadline:
        time.sleep(0.25)
    if site_status():
        raise LauncherError(f"Сервер ещё останавливается. Журнал: {LOG}")
    print("Campus Threads остановлен.")


def launch(mode):
    state = site_status()
    if state:
        if state["url"] and ready(state["local_url"]):
            if mode == "public" and state["mode"] != "public":
                stop()
            else:
                return state["url"] if mode == "public" else state["local_url"]
        else:
            raise LauncherError("Campus Threads запускается. Повтори команду через несколько секунд.")
    with LOG.open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            [sys.executable, "-X", "utf8", "-u", "-m", "server.launcher", "serve", mode],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline and process.poll() is None:
        state = site_status()
        if state and state["url"] and ready(state["local_url"]):
            return state["url"]
        time.sleep(0.25)
    raise LauncherError(f"Сайт не запустился. Журнал: {LOG}")


def restart():
    state = site_status()
    mode = state["mode"] if state and state["mode"] != "starting" else "local"
    stop()
    return launch(mode)


def moderator_menu():
    print("1. Выдать роль модератора сайта")
    print("2. Снять роль модератора сайта")
    print("3. Выдать роль модератора сообщества")
    print("4. Снять роль модератора сообщества")
    print("0. Назад")
    choice = input("> ").strip()
    if choice not in {"1", "2", "3", "4"}:
        return
    username = input("Имя пользователя Campus Threads: ").strip()
    if not username:
        return
    community = None
    if choice in {"3", "4"}:
        community = input("Точное название сообщества: ").strip()
        if not community:
            return
    change_moderator(username, enabled=choice in {"1", "3"}, community=community)


def menu():
    while True:
        state = site_status()
        print("\nCampus Threads")
        print((state["url"] or "Сайт запускается…") if state else "Сайт остановлен.")
        if state and state["mode"] == "public":
            print("На этом ПК:", state["local_url"])
        print("1. Открыть сайт или запустить локально")
        print("2. Получить временную ссылку для других устройств")
        print("3. Перезапустить и применить изменения")
        print("4. Остановить сайт и временную ссылку")
        print("5. Назначить организатора мероприятий")
        print("6. Права модераторов")
        print("0. Закрыть меню")
        choice = input("> ").strip()
        try:
            if choice == "0":
                return
            if choice == "4":
                stop()
            if choice == "5":
                username = input("Имя пользователя Campus Threads: ").strip()
                if username:
                    grant_event_organizer(username)
            if choice == "6":
                moderator_menu()
            if choice in {"1", "2", "3"}:
                url = restart() if choice == "3" else launch("public" if choice == "2" else "local")
                print(url)
                webbrowser.open(site_status()["local_url"])
        except (LauncherError, ValueError) as error:
            print(error)
        except DatabaseError:
            print("Запусти или перезапусти сайт из меню, затем повтори назначение.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", default="menu",
                        choices=["menu", "start", "share", "restart", "stop", "status", "serve"])
    parser.add_argument("mode", nargs="?", default="local", choices=["local", "public"])
    args = parser.parse_args()
    if args.command == "serve":
        serve(args.mode)
    elif args.command == "menu":
        menu()
    elif args.command == "stop":
        stop()
    elif args.command == "restart":
        print(restart())
    elif args.command == "status":
        state = site_status()
        print((state["url"] or "Сайт запускается…") if state else "Сайт остановлен.")
    else:
        print(launch("public" if args.command == "share" else "local"))


if __name__ == "__main__":
    try:
        main()
    except LauncherError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
