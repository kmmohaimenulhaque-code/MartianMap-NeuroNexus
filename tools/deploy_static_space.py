"""Deploy the static demo to a free Hugging Face *static* Space.

Docker and Gradio Spaces on free hardware need a PRO subscription (the API answers 402), so the public
demo is static: the production frontend built with VITE_DEMO_PACK=1 plus the demo pack recorded by
tools/record_demo_pack.mjs (real backend responses, replayed by a service worker, bannered in the UI).

  PLAYWRIGHT_MODULE=... node tools/record_demo_pack.mjs          # -> build/demo-pack
  python tools/deploy_static_space.py --space Mhaquehaque/neuronexus-marswalk

Authentication comes from HF_TOKEN or an authenticating proxy; no token is written to disk.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "build" / "demo-pack"
SITE = ROOT / "build" / "static-space"

README = """---
title: NeuroNexus Martian Map
colorFrom: blue
colorTo: gray
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Marswalk planning on HiRISE/CTX/MOLA with NASA mission data
---

# NeuroNexus · Interplanetary Survival Guide: Martian Map (static demo)

NASA Space Apps Challenge 2026. Source: https://github.com/kmmohaimenulhaque-code/martian-map
(branch `feature/mission-console-v2`, commit `{commit}`).

This Space is the console's production build in **static demo mode**: a service worker replays
{count:,} real API responses recorded on {recorded_at} from the live NeuroNexus backend (NASA PDS MOLA,
USGS STAC HiRISE/CTX, NASA MMGIS rover traverses, NASA Ames MGCM MY34 dust, MSL RAD, THEMIS). Requests
outside the recorded set answer `NOT_IN_DEMO_PACK`; no value is synthesized. Hugging Face hosts Docker
Spaces on paid hardware only, so live computation runs locally (README, Quick start).
"""


def build_frontend(recorded_at: str) -> None:
    env = {**os.environ, "VITE_DEMO_PACK": "1", "VITE_DEMO_RECORDED_AT": recorded_at}
    subprocess.run(["npm", "run", "build", "--", "--outDir", str(SITE), "--emptyOutDir"], cwd=ROOT / "frontend", env=env, check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--space", required=True, help="owner/name of the static Space")
    parser.add_argument("--dry-run", action="store_true", help="build the site folder only; do not upload")
    args = parser.parse_args(argv)

    manifest = json.loads((PACK / "manifest.json").read_text(encoding="utf-8"))
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    build_frontend(manifest["recorded_at"])
    shutil.copytree(PACK, SITE / "demo-pack", dirs_exist_ok=True)
    (SITE / "README.md").write_text(README.format(commit=commit[:12], count=manifest["count"], recorded_at=manifest["recorded_at"]), encoding="utf-8")
    files = sum(1 for p in SITE.rglob("*") if p.is_file())
    print(f"site: {SITE} ({files} files, demo pack {manifest['count']} responses)")
    if args.dry_run:
        return 0

    from huggingface_hub import HfApi

    api = HfApi(token=os.environ.get("HF_TOKEN"))
    api.create_repo(args.space, repo_type="space", space_sdk="static", private=False, exist_ok=True)
    info = api.upload_folder(folder_path=str(SITE), repo_id=args.space, repo_type="space",
                             commit_message=f"Static demo of {commit[:12]} ({manifest['count']} recorded responses)")
    owner, name = args.space.split("/", 1)
    print(f"uploaded: {info}")
    print(f"live: https://{owner.lower()}-{name.lower()}.static.hf.space  ·  page: https://huggingface.co/spaces/{args.space}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
