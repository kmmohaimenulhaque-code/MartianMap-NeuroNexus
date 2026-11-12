"""Generate frontend/tests/fixtures/eva_parity.json: inputs and backend outputs for the worker parity test.

  python tools/gen_parity_fixture.py          # write
  python tools/gen_parity_fixture.py --check  # fail if the committed fixture is stale
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from science.marswalk import config, eva_model  # noqa: E402

OUT = ROOT / "frontend" / "tests" / "fixtures" / "eva_parity.json"


def case(name: str, overrides: dict, n: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    ds = rng.uniform(0.5, 3.0, n)
    dz = rng.normal(0.0, 0.4, n)
    rough = rng.uniform(0.0, 0.8, n)
    rough[::7] = np.nan  # roughness unavailable on coarse rungs
    v = config.values(config.resolve(overrides))
    track = eva_model.along_track(ds, dz, rough, v)
    cum = np.concatenate([[0.0], np.cumsum(ds)])
    tp = eva_model.turnaround(cum, track["t_out"], track["t_back"], v["eva_duration_h"], v["reserve_fraction"])
    e_out, e_back = float(np.sum(track["e_out"])), float(np.sum(track["e_back"]))
    return {"name": name, "v": v, "ds": ds.tolist(), "dz": dz.tolist(), "rough": [None if np.isnan(x) else x for x in rough],
            "expected": {"outbound_h": tp["outbound_s"] / 3600, "return_h": tp["return_s"] / 3600,
                         "pnr_index": tp["index"], "pnr_distance_m": tp["distance_m"], "reached_target": tp["reached_target"],
                         "kcal_round_trip": eva_model.consumables(e_out + e_back, v)["metabolic_kcal_est"]["value"],
                         "o2_kg_outbound": eva_model.consumables(e_out, v)["o2_kg_est"]["value"]}}


def build() -> str:
    cases = [case("tobler-4h", {}, 300, 1), case("naismith-8h", {"pace_model": "naismith", "eva_duration_h": 8}, 400, 2),
             case("turnaround-short-eva", {"eva_duration_h": 0.5, "reserve_fraction": 0.5}, 900, 3)]
    return json.dumps({"generated_by": "tools/gen_parity_fixture.py", "tolerance_rel": 1e-6, "cases": cases}, indent=1) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    text = build()
    if args.check:
        ok = OUT.exists() and OUT.read_text() == text
        print("parity fixture up to date" if ok else "parity fixture stale: run python tools/gen_parity_fixture.py")
        return 0 if ok else 1
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
