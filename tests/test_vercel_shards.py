"""frontend/vercel.json is generated and routes every shard to its own services."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "gen_vercel_rewrites", Path(__file__).resolve().parents[1] / "tools" / "gen_vercel_rewrites.py")
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)


def test_vercel_json_is_current():
    assert gen.main(["--check"]) == 0


def test_twenty_distinct_services_all_routed():
    names = gen.service_names()
    assert len(names) == len(set(names)) == 20
    hosts = {re.match(r"https://([^/]+)", r["destination"]).group(1) for r in gen.build()["rewrites"] if r["destination"].startswith("http")}
    assert hosts == {f"{gen.PREFIX}-{n}.onrender.com" for n in names}


def _route(path: str, cookie: str | None) -> str:
    for rule in gen.build()["rewrites"]:
        has = rule.get("has")
        if has and (cookie is None or has[0]["value"] != cookie):
            continue
        pattern = "^" + re.escape(rule["source"]).replace(r":path\*", ".*") + "$"
        if rule["source"].startswith("/(("):
            pattern = "^" + rule["source"] + "$"
        if re.match(pattern, path):
            return rule["destination"]
    raise AssertionError(path)


def test_each_shard_keeps_its_traffic_together():
    for k in range(1, gen.SHARDS + 1):
        c = str(k)
        assert f"-s{k}-window." in _route("/api/terrain/hires/window", c)
        assert f"-s{k}-window." in _route("/api/terrain/sources", c)
        assert f"-s{k}-image." in _route("/api/terrain/hires/image", c)
        assert f"-s{k}-marswalk." in _route("/api/marswalk/plan", c)
        assert f"-s{k}-marswalk." in _route("/api/marswalk/brief/0123456789abcdef", c)
        core = "core-a" if k <= 3 else "core-b"
        assert f"-{core}." in _route("/api/environment", c)
        assert f"-{core}." in _route("/terrain/window", c)


def test_missing_or_bad_cookie_falls_back_to_shard_one():
    for cookie in (None, "7", "x"):
        assert "-s1-image." in _route("/api/terrain/hires/image", cookie)
        assert "-core-a." in _route("/api/health", cookie)
    assert _route("/marswalk", None) == "/index.html"
