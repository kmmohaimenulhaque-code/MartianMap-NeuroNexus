"""Single-process server: the NeuroNexus API plus the built console (frontend/dist).

Routing matches the Vite dev proxy and deploy/nginx.conf, so the console needs no
configuration: /api/* goes to the API with the /api prefix removed (ASGI root_path),
/terrain/* goes to the API unchanged, and everything else is the static console with
an index.html fallback.

  cd frontend && npm run build && cd ..
  python -m uvicorn science.serve:app --host 0.0.0.0 --port 7860
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.responses import PlainTextResponse
from starlette.staticfiles import StaticFiles

from science.rovers.api import warm as warm_rover_lines
from science.weather.api.environment import app as api


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


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        await api(scope, receive, send)
        return
    path = scope.get("path", "")
    if path == "/api" or path.startswith("/api/"):
        await api({**scope, "root_path": scope.get("root_path", "") + "/api"}, receive, send)
    elif path.startswith(API_PASSTHROUGH):
        await api(scope, receive, send)
    else:
        await console(scope, receive, send)
