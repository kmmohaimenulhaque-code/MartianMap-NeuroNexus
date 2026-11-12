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


def test_every_service_distinct_and_routed():
    names = gen.service_names()
    assert len(names) == len(set(names)) == 2 + 2 + 3 * gen.SHARDS
    hosts = {re.match(r"https://[^/]+", r["destination"]).group(0) for r in gen.build()["rewrites"] if r["destination"].startswith("http")}
    assert hosts == {gen.host(n) for n in names}
    assert len({gen.host(n) for n in names}) == len(names)


def _route(path: str, cookie: str | None) -> str:
    for rule in gen.build()["rewrites"]:
        has = rule.get("has")
        if has and (cookie is None or has[0]["value"] != cookie):
            continue
        pattern = "^" + re.escape(rule["source"]).replace(r":path\*", ".*") + "$"
        if rule["source"].startswith("/((") or rule["source"].endswith("(.*)"):
            pattern = "^" + rule["source"] + "$"
        if re.match(pattern, path):
            return rule["destination"]
    raise AssertionError(path)


def _on(name: str, url: str) -> bool:
    return url.startswith(gen.host(name) + "/")


def test_each_shard_keeps_its_traffic_together():
    for k in range(1, gen.SHARDS + 1):
        c = str(k)
        assert _on(f"terrain{k}", _route("/api/terrain/hires/window", c))
        assert _on(f"terrain{k}", _route("/api/terrain/sources", c))
        assert _on(f"image{k}", _route("/api/terrain/hires/image", c))
        assert _on(f"marswalk{k}", _route("/api/marswalk/plan", c))
        assert _on(f"marswalk{k}", _route("/api/marswalk/brief/0123456789abcdef", c))
        core = 1 if k <= 3 else 2
        assert _on(f"usgs{core}", _route("/api/usgs/route-snapshot", c))
        assert _on(f"core{core}", _route("/api/environment", c))
        assert _on(f"core{core}", _route("/terrain/window", c))


def test_missing_or_bad_cookie_falls_back_to_shard_one():
    for cookie in (None, "7", "x"):
        assert _on("image1", _route("/api/terrain/hires/image", cookie))
        assert _on("core1", _route("/api/health", cookie))
    assert _route("/marswalk", None) == "/index.html"


def test_blueprint_creates_exactly_the_routed_services():
    names = re.findall(r"^    name: (\S+)$", gen.render_blueprint(), flags=re.M)
    assert names == gen.service_names()
    parts = re.findall(r"^        value: (terrain-window|terrain-image|marswalk|usgs)$", gen.render_blueprint(), flags=re.M)
    kind = {"usgs": "usgs", "terrain": "terrain-window", "image": "terrain-image", "marswalk": "marswalk"}
    assert parts == [kind[n.rstrip("0123456789")] for n in gen.service_names() if not n.startswith("core")]


def test_landing_wakes_every_service():
    import json
    urls = json.loads(gen.WAKE.read_text(encoding="utf-8"))["urls"]
    assert urls == [gen.health_url(n) for n in gen.service_names()]


def test_pages_route_to_their_own_entry():
    # Landing at /, console at /console/, gallery at /tutorials/ (real files are served before rewrites).
    assert _route("/console/anything", None) == "/console/index.html"
    assert _route("/tutorials/x", None) == "/tutorials/index.html"
    assert _route("/about", None) == "/index.html"
