"""Uniform error JSON for the Marswalk-era endpoints: {error, reason, hint, detail}.

``detail`` repeats ``reason`` so existing clients that read ``body.detail`` keep working.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, error: str, reason: str, hint: str = ""):
        super().__init__(reason)
        self.status, self.error, self.reason, self.hint = status, error, reason, hint

    def body(self) -> dict:
        return {"error": self.error, "reason": self.reason, "hint": self.hint, "detail": self.reason}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _handle(_request: Request, exc: ApiError):  # noqa: RUF029
        return JSONResponse(status_code=exc.status, content=exc.body())


def unavailable(reason: str, hint: str = "") -> ApiError:
    return ApiError(503, "UNAVAILABLE", reason, hint)


def bad_request(reason: str, hint: str = "") -> ApiError:
    return ApiError(400, "BAD_REQUEST", reason, hint)
