"""One slice of the API on its own small server, for hosts with 512 MB instances.

The full app (science.serve) idles at about 400 MB because it loads pandas/pyarrow, THEMIS,
the dust scenario and Gemini. The meter-scale terrain work peaks at several hundred MB on top
of that, so on a 512 MB instance it gets killed. Each part here imports only its own router
(about 120 MB idle) and runs one heavy request at a time, so a slice fits in 512 MB.

  NN_PART=terrain-window  /api/terrain/hires/window, /api/terrain/sources
  NN_PART=terrain-image   /api/terrain/hires/image
  NN_PART=marswalk        /api/marswalk/*

  NN_PART=terrain-window python -m uvicorn science.serve_part:app --host 0.0.0.0 --port 7861

Routing matches science.serve: /api/* reaches the API with the prefix removed. The console's
host (Vercel rewrites) sends each path to its part and everything else to science.serve.
"""
from __future__ import annotations

import asyncio
import ctypes
import gc
import os
from contextlib import asynccontextmanager

# GDAL sizes its block cache from the host's RAM unless told otherwise; set before rasterio loads.
os.environ.setdefault("GDAL_CACHEMAX", "32")

try:
    _libc = ctypes.CDLL("libc.so.6")
except OSError:  # not glibc (macOS, musl): nothing to tune
    _libc = None
if _libc is not None:
    # glibc raises its mmap threshold after a large block is freed, so later terrain arrays land on
    # the heap, fragment it and are never returned: idle memory creeps up frame after frame. A fixed
    # threshold keeps every large numpy array in its own mapping that goes back to the OS on free
    # (measured: idle after 12 frames 352 MB -> 240 MB, peak 538 MB -> 413 MB). Set before numpy loads.
    M_TRIM_THRESHOLD, M_MMAP_THRESHOLD, M_ARENA_MAX = -1, -3, -8
    _libc.mallopt(M_MMAP_THRESHOLD, 128 * 1024)
    _libc.mallopt(M_TRIM_THRESHOLD, 128 * 1024)
    _libc.mallopt(M_ARENA_MAX, 2)

import anyio.to_thread  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from science.hires import ladder  # noqa: E402
from science.marswalk import planner  # noqa: E402
from science.ops.errors import install as install_error_handlers  # noqa: E402

PARTS = {"terrain-window", "terrain-image", "marswalk"}
PART = os.environ.get("NN_PART", "terrain-window")
if PART not in PARTS:
    raise RuntimeError(f"NN_PART must be one of {sorted(PARTS)}, not {PART!r}")
HEAVY_CONCURRENCY = max(1, int(os.environ.get("NN_HEAVY_CONCURRENCY", "1")))
THREADS = max(HEAVY_CONCURRENCY + 1, int(os.environ.get("NN_THREADS", "2")))
# Cached terrain frames and planner layer sets are the memory that stays after a request.
ladder.CACHE_WINDOWS = max(1, int(os.environ.get("NN_WINDOW_CACHE", "2")))
planner.LAYER_CACHE = max(1, int(os.environ.get("NN_LAYER_CACHE", "1")))


@asynccontextmanager
async def _lifespan(_app):
    # Sync endpoints run on anyio's worker threads (40 by default). GDAL and PROJ keep state per
    # thread, so a fresh thread per request adds memory; a tiny pool reuses the same threads.
    anyio.to_thread.current_default_thread_limiter().total_tokens = THREADS
    yield


api = FastAPI(title=f"NeuroNexus API part: {PART}", version="1.0.0", lifespan=_lifespan)
api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"],
                   allow_headers=["*"])
install_error_handlers(api)
SERVED_BY = os.environ.get("RENDER_SERVICE_NAME") or os.environ.get("NN_SERVICE_NAME") or PART


@api.middleware("http")
async def _served_by(request, call_next):
    response = await call_next(request)
    response.headers["X-NeuroNexus-Served-By"] = SERVED_BY  # which shard answered (routing checks)
    return response

if PART == "marswalk":
    from science.marswalk.api import router  # noqa: E402
else:
    from science.hires.api import router  # noqa: E402
api.include_router(router)


@api.get("/health")
async def health():
    return {"status": "ok", "part": PART, "heavy_concurrency": HEAVY_CONCURRENCY,
            "window_cache": ladder.CACHE_WINDOWS, "layer_cache": planner.LAYER_CACHE}


_gate = asyncio.Semaphore(HEAVY_CONCURRENCY)
LIGHT_PATHS = ("/health", "/marswalk/config", "/docs", "/openapi.json")


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        await api(scope, receive, send)
        return
    path = scope.get("path", "")
    if path == "/api" or path.startswith("/api/"):
        scope = {**scope, "root_path": scope.get("root_path", "") + "/api"}
        path = path[4:] or "/"
    if scope["type"] != "http" or path.startswith(LIGHT_PATHS):
        await api(scope, receive, send)
        return
    # Heavy requests queue here instead of running side by side: two terrain frames at once
    # would double the peak and get the instance killed.
    async with _gate:
        try:
            await api(scope, receive, send)
        finally:
            _release_memory()


def _release_memory() -> None:
    """Hand freed heap back to the OS. Without it glibc keeps the high-water mark of every terrain
    frame, and a 512 MB instance creeps upward with each new location until it is killed."""
    gc.collect()
    if _libc is not None:
        _libc.malloc_trim(0)
