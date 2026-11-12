"""Stream MSL RAD RDR files from PDS PPI into per-sol dose-rate summaries (raw files are not kept).

  python tools/fetch_rad.py --latest 30            # the last 30 archived sols
  python tools/fetch_rad.py --every 7 --span 690   # one sol in 7 over about a Mars year (for V7)
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from science.conditions import rad  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--latest", type=int, default=0)
    parser.add_argument("--every", type=int, default=0)
    parser.add_argument("--span", type=int, default=690)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args(argv)
    files = rad.list_sol_files()
    last = max(files)
    wanted = set(s for s in files if s > last - args.latest) if args.latest else set()
    if args.every:
        wanted |= {s for s in files if s > last - args.span and (last - s) % args.every == 0}
    snap = rad.load_snapshot()
    snap.setdefault("sols", {})
    todo = sorted(s for s in wanted if str(s) not in snap["sols"])
    print(f"archive: {len(files)} sols, latest {last}; fetching {len(todo)}", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for summary in pool.map(lambda s: rad.summarize_sol(s, files[s]), todo):
            snap["sols"][str(summary["sol"])] = summary
            print(f"sol {summary['sol']}: {summary['status']} {summary.get('median_e_ugy_h')}", flush=True)
    snap.update({"source": "MSL RAD RDR, PDS PPI MSL-M-RAD-3-RDR-V1.0 (DOSIMETRY_TOTAL_DOSE_E, uGy/h)",
                 "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"), "latest_archived_sol": last})
    snap["sols"] = dict(sorted(snap["sols"].items(), key=lambda kv: int(kv[0])))
    rad.SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    rad.SNAPSHOT.write_text(json.dumps(snap, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
