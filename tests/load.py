"""Нагрузка на настоящий HTTP API с изолированными тестовыми пользователями."""
import argparse
import asyncio
import json
import os
import platform
import statistics
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent


def percentile(values, percent):
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * percent))], 1)


async def measure(fixtures, count, actions):
    timings = []
    statuses = Counter()
    operations = Counter()
    limits = httpx.Limits(max_connections=count, max_keepalive_connections=count)
    async with httpx.AsyncClient(base_url=fixtures["origin"], timeout=12, limits=limits) as client:
        async def participant(index):
            user = fixtures["users"][index]
            headers = {"Cookie": "campus_session=" + user["session"], "Origin": fixtures["origin"]}
            for step in range(actions):
                operation = step % 6
                start = time.perf_counter()
                try:
                    if operation in (0, 1, 2):
                        response = await client.get("/api/feed", headers=headers)
                        label = "feed"
                    elif operation == 3:
                        response = await client.put(f"/api/posts/{fixtures['post']}/like",
                                                    json={"enabled": step < 6}, headers=headers)
                        label = "like"
                    elif operation == 4:
                        response = await client.get("/api/search", params={"term": "проект"}, headers=headers)
                        label = "search"
                    else:
                        response = await client.post("/api/posts",
                                                     json={"content": f"Нагрузка {count}-{index}-{step}",
                                                           "parent": fixtures["post"]}, headers=headers)
                        label = "reply"
                    statuses[str(response.status_code)] += 1
                    operations[label] += 1
                except httpx.HTTPError:
                    statuses["network_error"] += 1
                timings.append((time.perf_counter() - start) * 1000)
                await asyncio.sleep(.1)

        started = time.perf_counter()
        await asyncio.gather(*(participant(index) for index in range(count)))
        elapsed = time.perf_counter() - started
    errors = sum(number for status, number in statuses.items() if status not in ("200", "201", "204"))
    return {
        "concurrent_users": count, "requests": len(timings), "duration_seconds": round(elapsed, 2),
        "requests_per_second": round(len(timings) / elapsed, 2), "errors": errors,
        "p50_ms": round(statistics.median(timings), 1), "p95_ms": percentile(timings, .95),
        "max_ms": round(max(timings), 1), "statuses": dict(statuses), "operations": dict(operations),
    }


async def run(args):
    output = ROOT / "tests/reports"
    output.mkdir(exist_ok=True)
    with (ROOT / ".runtime/load-server.log").open("w", encoding="utf-8") as log:
        server = subprocess.Popen(
            [sys.executable, "-X", "utf8", "tests/support_server.py", "--port", "8002", "--users", str(max(args.users))],
            cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            async with httpx.AsyncClient() as check:
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError("Тестовый сервер завершился. Проверь .runtime/load-server.log.")
                    try:
                        if (await check.get("http://127.0.0.1:8002/api/health", timeout=1)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(.3)
                else:
                    raise RuntimeError("Тестовый сервер не запустился.")
            fixtures = json.loads((ROOT / ".runtime/test-fixtures.json").read_text(encoding="utf-8"))
            assert fixtures["origin"] == "http://127.0.0.1:8002"
            results = []
            for count in args.users:
                result = await measure(fixtures, count, args.actions)
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            report = {
                "tested_at": datetime.now(timezone.utc).isoformat(),
                "environment": "Local Windows HTTP server and PostgreSQL, not Render/Neon",
                "cpu": platform.processor(), "logical_cpus": os.cpu_count(), "python": platform.python_version(),
                "pool_max_connections": 8, "seed_posts": 35, "actions_per_user": args.actions,
                "think_time_ms": 100,
                "notes": "Authenticated feed/search/like/reply workload. Registration and bcrypt login are outside this measurement.",
                "results": results,
            }
            (output / "load.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--users", nargs="+", type=int, default=[20, 50, 100])
    parser.add_argument("--actions", type=int, default=12)
    args = parser.parse_args()
    if min(args.users) < 1 or max(args.users) > 500 or not 1 <= args.actions <= 100:
        parser.error("users: 1–500, actions: 1–100")
    (ROOT / ".runtime").mkdir(exist_ok=True)
    asyncio.run(run(args))
