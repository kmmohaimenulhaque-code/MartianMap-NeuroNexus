"""Wake the live console and every Render service behind it (one scheduled visit).

  python tools/warm_link.py                      # default link (the v4 Vercel preview)
  python tools/warm_link.py https://example.app   # another link

Free Render services sleep after 15 min idle and a cold start takes 20-90 s. One visit loads the page, wakes all
services from tools/gen_vercel_rewrites.py in parallel (GET /health on each, one retry for late wakes), then asks each core for the rover
traverse lines so their one-time display-line computation is done before a judge arrives. Exit code 1 if anything
failed; every line printed is one service.
"""
from __future__ import annotations

import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_vercel_rewrites import host, service_names  # noqa: E402

LINK = "https://martian-map-git-feature-mission-c-51d8a5-kmmohaimenulhaque-code.vercel.app"
TIMEOUT_S = 180  # a cold start plus the first request stays well under this


def get(url: str) -> tuple[str, int | str, float]:
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
            response.read()
            status: int | str = response.status
    except Exception as exc:  # noqa: BLE001 - report every failure, keep visiting the rest
        status = f"ERROR {str(exc)[:80]}"
    return url, status, round(time.perf_counter() - t0, 1)


def main(argv: list[str] | None = None) -> int:
    link = ((argv or sys.argv[1:]) or [LINK])[0].rstrip("/")
    urls = [link + "/"] + [host(name) + ("/api/health" if name.startswith("core") else "/health") for name in service_names()]
    with ThreadPoolExecutor(max_workers=len(urls)) as pool:
        results = list(pool.map(get, urls))
    # Waking 18+ services at once can take Render more than 180 s; a wake keeps going server-side, so one retry
    # of the late ones normally finds them up.
    late = [url for url, status, _s in results if status != 200]
    if late:
        with ThreadPoolExecutor(max_workers=len(late)) as pool:
            retried = {r[0]: r for r in pool.map(get, late)}
        results = [retried.get(r[0], r) for r in results]
    # Second pass after every service is up: precompute the cores' rover display lines.
    warm = [host(core) + f"/api/rovers/{rover}/traverse?max_vertices=3000" for core in ("core-a", "core-b") for rover in ("msl", "m2020")]
    with ThreadPoolExecutor(max_workers=len(warm)) as pool:
        results += list(pool.map(get, warm))
    failed = [r for r in results if r[1] != 200]
    for url, status, seconds in results:
        print(f"{status!s:>4}  {seconds:6.1f} s  {url}")
    print(f"{len(results) - len(failed)}/{len(results)} OK")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
