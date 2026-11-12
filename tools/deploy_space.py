"""Deploy the console to a Hugging Face Docker Space at a pinned commit.

Uploads deploy/space/{Dockerfile,README.md} with NN_REF set to the commit to build. The
commit must already be pushed to GitHub. Authentication comes from the environment
(HF_TOKEN) or an authenticating proxy; no token is ever written to disk.

  python tools/deploy_space.py --space Mhaquehaque/neuronexus-marswalk --ref $(git rev-parse HEAD)
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
HF = "https://huggingface.co"


def _headers() -> dict:
    token = os.environ.get("HF_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def ensure_space(space: str) -> None:
    owner, name = space.split("/", 1)
    r = requests.get(f"{HF}/api/spaces/{space}", headers=_headers(), timeout=30)
    if r.status_code == 200:
        return
    body = {"type": "space", "name": name, "organization": None, "sdk": "docker", "private": False}
    r = requests.post(f"{HF}/api/repos/create", json=body, headers=_headers(), timeout=60)
    if r.status_code not in (200, 409):
        raise SystemExit(f"create failed: {r.status_code} {r.text[:300]}")


def commit(space: str, ref: str) -> str:
    dockerfile = (ROOT / "deploy/space/Dockerfile").read_text(encoding="utf-8")
    dockerfile, n = re.subn(r"^ARG NN_REF=.*$", f"ARG NN_REF={ref}", dockerfile, count=1, flags=re.M)
    if n != 1:
        raise SystemExit("deploy/space/Dockerfile has no 'ARG NN_REF=' line")
    files = {"Dockerfile": dockerfile, "README.md": (ROOT / "deploy/space/README.md").read_text(encoding="utf-8")}
    lines = [{"key": "header", "value": {"summary": f"Deploy {ref[:12]}", "description": ""}}]
    for path, text in files.items():
        lines.append({"key": "file", "value": {"path": path, "encoding": "base64",
                                               "content": base64.b64encode(text.encode()).decode()}})
    payload = "\n".join(json.dumps(line) for line in lines)
    r = requests.post(f"{HF}/api/spaces/{space}/commit/main", data=payload, timeout=60,
                      headers={**_headers(), "Content-Type": "application/x-ndjson"})
    if r.status_code != 200:
        raise SystemExit(f"commit failed: {r.status_code} {r.text[:300]}")
    return r.json().get("commitOid", "")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--space", default="Mhaquehaque/neuronexus-marswalk")
    parser.add_argument("--ref", required=True, help="full git commit SHA already pushed to GitHub")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[0-9a-f]{40}", args.ref):
        parser.error("--ref must be a full 40-character commit SHA")
    ensure_space(args.space)
    oid = commit(args.space, args.ref)
    owner, name = args.space.split("/", 1)
    print(f"space commit {oid}\nlive: https://{owner.lower()}-{name.lower()}.hf.space\npage: {HF}/spaces/{args.space}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
