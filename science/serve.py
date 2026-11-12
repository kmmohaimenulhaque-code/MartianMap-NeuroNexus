"""Single-process server: the NeuroNexus API plus the built console (frontend/dist).

Routing matches the Vite dev proxy and deploy/nginx.conf, so the console needs no
configuration: /api/* goes to the API with the /api prefix removed (ASGI root_path),
/terrain/* goes to the API unchanged, and everything else is the static console with
an index.html fallback.

  cd frontend && npm run build && cd ..
  python -m uvicorn science.serve:app --host 0.0.0.0 --port 7860
"""
from __future__ import annotations

import ctypes
import os
import threading
import time
from pathlib import Path

# Same allocator settings as the split API parts (science/serve_part.py), set before numpy loads: without a fixed
# mmap threshold and few arenas, glibc keeps the high-water mark of every request's arrays and a 512 MB core
# creeps up to its limit and thrashes. GDAL sizes its block cache from host RAM unless told otherwise.
os.environ.setdefault("GDAL_CACHEMAX", "32")
try:
    _libc = ctypes.CDLL("libc.so.6")
except OSError:  # not glibc (macOS, musl): nothing to tune
    _libc = None
if _libc is not None:
    M_TRIM_THRESHOLD, M_MMAP_THRESHOLD, M_ARENA_MAX = -1, -3, -8
    _libc.mallopt(M_MMAP_THRESHOLD, 128 * 1024)
    _libc.mallopt(M_TRIM_THRESHOLD, 128 * 1024)
    _libc.mallopt(M_ARENA_MAX, 2)

from starlette.exceptions import HTTPException  # noqa: E402
from starlette.responses import PlainTextResponse  # noqa: E402
from starlette.staticfiles import StaticFiles  # noqa: E402

from science.rovers.api import warm as warm_rover_lines  # noqa: E402
from science.weather.api.environment import app as api  # noqa: E402


def _warm_caches() -> None:
    # CPU-bound display simplification of the rover traverses, done once off the request path.
    if os.environ.get("NN_WARM_CACHES", "1") == "1":
        threading.Thread(target=warm_rover_lines, name="nn-warm", daemon=True).start()


api.router.on_startup.append(_warm_caches)

DIST = Path(os.environ.get("NEURONEXUS_DIST", Path(__file__).resolve().parents[1] / "frontend" / "dist"))
API_PASSTHROUGH = ("/terrain/",)


class ConsoleFiles(StaticFiles):
    """Static console; unknown extension-less paths fall back to index.html."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404 and "." not in path.rsplit("/", 1)[-1]:
                return await super().get_response("index.html", scope)
            # Mounted bare (no exception middleware), so answer instead of raising.
            return PlainTextResponse(str(exc.detail), status_code=exc.status_code)


console = ConsoleFiles(directory=DIST, html=True, check_dir=False)

_last_trim = 0.0


def _release_memory(min_interval_s: float = 2.0) -> None:
    """Hand freed heap back to the OS after API requests, at most every couple of seconds (a page load fires
    ~30 requests; trimming after each one would cost more than it returns)."""
    global _last_trim
    now = time.monotonic()
    if _libc is not None and now - _last_trim >= min_interval_s:
        _last_trim = now
        _libc.malloc_trim(0)


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        await api(scope, receive, send)
        return
    path = scope.get("path", "")
    if path == "/api" or path.startswith("/api/"):
        try:
            await api({**scope, "root_path": scope.get("root_path", "") + "/api"}, receive, send)
        finally:
            _release_memory()
    elif path.startswith(API_PASSTHROUGH):
        try:
            await api(scope, receive, send)
        finally:
            _release_memory()
    else:
        await console(scope, receive, send)
