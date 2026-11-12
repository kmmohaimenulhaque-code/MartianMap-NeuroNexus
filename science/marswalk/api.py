"""POST /marswalk/plan, POST /marswalk/evaluate, GET /marswalk/config, GET /marswalk/brief/{plan_id}."""
from __future__ import annotations

import json
import re
import threading
import time
from collections import OrderedDict

from fastapi import APIRouter, Body, Query
from fastapi.responses import HTMLResponse, JSONResponse

from science import settings
from science.marswalk import brief, config, planner
from science.ops.errors import ApiError, bad_request, unavailable

router = APIRouter(prefix="/marswalk", tags=["marswalk"])
_plans: OrderedDict[str, dict] = OrderedDict()
_lock = threading.Lock()


def _plans_dir():
    path = settings.cache_root() / "marswalk" / "plans"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store(plan: dict) -> None:
    with _lock:
        _plans[plan["plan_id"]] = plan
        while len(_plans) > 32:
            _plans.popitem(last=False)
    try:
        (_plans_dir() / f"{plan['plan_id']}.json").write_text(json.dumps(plan), encoding="utf-8")
    except OSError:
        pass  # read-only deployments keep the in-memory copy


def _run(fn, request: dict) -> JSONResponse:
    start = time.perf_counter()
    try:
        result = fn(request)
    except planner.PlanError as exc:
        raise ApiError(422, "NO_PLAN", str(exc), "move the points or relax a planning parameter") from exc
    except (KeyError, TypeError) as exc:
        raise bad_request(f"malformed request: {exc}", "see GET /marswalk/config and the API contract") from exc
    except ValueError as exc:
        raise bad_request(str(exc)) from exc
    except (OSError, FileNotFoundError) as exc:
        raise unavailable(str(exc), "terrain data unreachable; build the demo pack or check the network") from exc
    _store(result)
    elapsed = time.perf_counter() - start
    return JSONResponse(result, headers={"X-NeuroNexus-Timing-s": f"{elapsed:.3f}"})


@router.post("/plan")
def plan(request: dict = Body(...)):  # noqa: B008
    return _run(planner.plan, request)


@router.post("/evaluate")
def evaluate(request: dict = Body(...)):  # noqa: B008
    return _run(planner.evaluate_polyline, request)


@router.get("/config")
def get_config():
    params = config.resolve()
    return {"parameters": params, "config_hash": config.config_hash(params), "bounds": config.BOUNDS,
            "limits_for_ui": list(config.LIMITS_FOR_UI), "status_rule_text": config.status_rule_text(config.values(params)),
            "terrain_modes": ["ladder", "ctx_mola", "mola"], "sites": planner.SITES,
            "source": {"ledger_id": "NEURONEXUS_MARSWALK_PARAMETERS"}}


@router.get("/brief/{plan_id}")
def get_brief(plan_id: str, format: str = Query("json", pattern="^(json|html)$")):  # noqa: A002
    if not re.fullmatch(r"[0-9a-f]{16}", plan_id):
        raise bad_request("plan_id must be 16 hex characters")
    with _lock:
        plan_data = _plans.get(plan_id)
    if plan_data is None:
        path = _plans_dir() / f"{plan_id}.json"
        if not path.exists():
            raise ApiError(404, "NOT_FOUND", f"plan {plan_id} not found", "POST /marswalk/plan first")
        plan_data = json.loads(path.read_text(encoding="utf-8"))
    data = brief.build(plan_data)
    return HTMLResponse(brief.html_page(data)) if format == "html" else data
