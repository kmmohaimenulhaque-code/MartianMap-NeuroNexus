"""Write frontend/vercel.json for the sharded split API (20 free 512 MB Render services).

Layout: 2 core services (the full app) and SHARDS shards of 3 parts each (science/serve_part.py).
The console sets a sticky nn_shard cookie (frontend/src/shard.js); each rewrite matches it, so one
browser always reaches the same shard. Shards 1-3 use core-a, shards 4-6 core-b. Requests without a
valid cookie fall through to shard 1.

  python tools/gen_vercel_rewrites.py          # writes frontend/vercel.json
  python tools/gen_vercel_rewrites.py --check  # fails if the file is stale
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "vercel.json"
PREFIX = "nn-v4"
SHARDS = 6
CORES = ("a", "b")
PART_PATHS = (
    ("window", "/api/terrain/hires/window"),
    ("window", "/api/terrain/sources"),
    ("image", "/api/terrain/hires/image"),
    ("marswalk", "/api/marswalk/:path*"),
)
CORE_PATHS = ("/api", "/api/:path*", "/terrain/:path*")


def host(name: str) -> str:
    return f"https://{PREFIX}-{name}.onrender.com"


def core_for(shard: int) -> str:
    return CORES[(shard - 1) * len(CORES) // SHARDS]


def service_names() -> list[str]:
    names = [f"core-{c}" for c in CORES]
    for k in range(1, SHARDS + 1):
        names += [f"s{k}-window", f"s{k}-image", f"s{k}-marswalk"]
    return names


def _rules(shard: int, has: list | None) -> list[dict]:
    extra = {"has": has} if has else {}
    rules = [{"source": src, "destination": host(f"s{shard}-{part}") + src, **extra} for part, src in PART_PATHS]
    rules += [{"source": src, "destination": host(f"core-{core_for(shard)}") + src, **extra} for src in CORE_PATHS]
    return rules


def build() -> dict:
    rewrites = []
    for k in range(1, SHARDS + 1):
        rewrites += _rules(k, [{"type": "cookie", "key": "nn_shard", "value": str(k)}])
    rewrites += _rules(1, None)  # no or invalid cookie
    rewrites.append({"source": "/((?!api/|terrain/).*)", "destination": "/index.html"})
    return {"$schema": "https://openapi.vercel.sh/vercel.json", "rewrites": rewrites}


def render() -> str:
    return json.dumps(build(), indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    if args.check:
        if OUT.read_text(encoding="utf-8") != render():
            print("frontend/vercel.json is stale: run python tools/gen_vercel_rewrites.py", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(build()['rewrites'])} rewrites, {len(service_names())} services")
    return 0


if __name__ == "__main__":
    sys.exit(main())
