"""V3 slope scale-dependence: rover IMU tilt vs DTM slope at several baselines."""
from __future__ import annotations

import numpy as np

from science.validation import stats
from science.validation.elevation import column

SERIES = [("HIRISE", 1), ("HIRISE", 3), ("HIRISE", 5), ("HIRISE", 10), ("HIRISE", 20), ("HIRISE", 100),
          ("CTX", 20), ("CTX", 100), ("MOLA", 463)]


def v3(rows: list[dict]) -> dict:
    tilt = column(rows, "tilt")
    out = {"metric": "rover IMU tilt vs DTM slope at the waypoint", "unit": "deg", "series": []}
    for family, b in SERIES:
        key = f"slope_{family.lower()}_{b}"
        s = stats.summarize_slope(tilt, column(rows, key))
        out["series"].append({"family": family, "baseline_m": b, **s})
    out["tilt"] = {"median_deg": float(np.nanmedian(tilt)), "p90_deg": float(np.nanpercentile(tilt, 90)),
                   "max_deg": float(np.nanmax(tilt)), "n": int(np.isfinite(tilt).sum())}
    out["caveats"] = ["Rocks under the wheels tilt the rover without being in any DTM.",
                      "Drivers park deliberately on gentle ground and avoid hazards: drivable ground is over-sampled.",
                      "Curiosity's wheelbase is about 1.9 m and both rovers are about 3 m long: the 3 m baseline is the "
                      "closest to the vehicle footprint."]
    return out


def series(report_v3: dict, family: str, baseline: int) -> dict:
    return next(s for s in report_v3["series"] if s["family"] == family and s["baseline_m"] == baseline)
