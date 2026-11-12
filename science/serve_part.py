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
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from science.ops.errors import install as install_error_handlers

PARTS = {"terrain-window", "terrain-image", "marswalk"}
PART = os.environ.get("NN_PART", "terrain-window")
if PART not in PARTS:
    raise RuntimeError(f"NN_PART must be one of {sorted(PARTS)}, not {PART!r}")
HEAVY_CONCURRENCY = max(1, int(os.environ.get("NN_HEAVY_CONCURRENCY", "1")))

api = FastAPI(title=f"NeuroNexus API part: {PART}", version="1.0.0")
api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"],
                   allow_headers=["*"])
install_error_handlers(api)

if PART == "marswalk":
    from science.marswalk.api import router
else:
    from science.hires.api import router
api.include_router(router)


@api.get("/health")
def health():
    return {"status": "ok", "part": PART, "heavy_concurrency": HEAVY_CONCURRENCY}


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
        await api(scope, receive, send)
