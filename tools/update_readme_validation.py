"""Rewrite the README "What's validated" table from validation/reports/latest.json (never by hand).

  python tools/update_readme_validation.py          # rewrite between the markers
  python tools/update_readme_validation.py --check  # fail if the README table is stale
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
LATEST = ROOT / "validation" / "reports" / "latest.json"
START, END = "<!-- VALIDATION:START -->", "<!-- VALIDATION:END -->"


def table(latest: dict) -> str:
    lines = [START, "", f"Run `{latest['run_id']}` · generated {latest['generated_at']} · `python -m science.validation.run --site all`", "",
             "| site | id | metric | value | 95% CI | n | what it means |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for site in ("gale", "jezero"):
        entry = latest["sites"].get(site)
        if not entry:
            continue
        for h in entry["headline"]:
            ci = "" if not h.get("ci95") else f"{h['ci95'][0]} – {h['ci95'][1]}"
            lines.append(f"| {site.title()} | {h['id']} | {h['label']} | **{h['value']}** | {ci} | {h['n']:,} | {h['meaning']} |")
        v5 = entry.get("V5", {})
        if v5:
            lines.append(f"| {site.title()} | V5 | Plans byte-identical on rerun | **{v5['identical']}/{v5['ran']}** |  | "
                         f"{v5['ran']} | same request + data versions → same plan |")
    lines += ["", END]
    return "\n".join(lines)


def render(readme: str, latest: dict) -> str:
    if START not in readme or END not in readme:
        raise SystemExit("README.md has no validation markers")
    head, rest = readme.split(START, 1)
    _, tail = rest.split(END, 1)
    return head + table(latest) + tail


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    latest = json.loads(LATEST.read_text(encoding="utf-8"))
    readme = README.read_text(encoding="utf-8")
    new = render(readme, latest)
    if args.check:
        if new != readme:
            print("README validation table is stale: run python tools/update_readme_validation.py", file=sys.stderr)
            return 1
        print("README validation table matches latest.json")
        return 0
    README.write_text(new, encoding="utf-8")
    print("README validation table updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
