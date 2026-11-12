"""V6 seams: elevation differences where HiRISE, CTX and MOLA overlap around the waypoints."""
from __future__ import annotations

import numpy as np

from science.validation import stats
from science.validation.elevation import column

STEP_FLAG_M = 2.0


def v6(rows: list[dict]) -> dict:
    hc = column(rows, "seam_hirise_ctx_median_m")
    ok = hc[np.isfinite(hc)]
    out = {"metric": "per-waypoint median elevation step between overlapping products", "unit": "m",
           "flag_threshold_m": STEP_FLAG_M,
           "hirise_minus_ctx_20m": {**stats.summarize_diff(ok),
                                     "share_flagged": float(np.mean(np.abs(ok) > STEP_FLAG_M)) if ok.size else None},
           "hirise_minus_mola": stats.summarize_diff(column(rows, "elev_hirise") - column(rows, "elev_mola")),
           "ctx_minus_mola": stats.summarize_diff(column(rows, "elev_ctx") - column(rows, "elev_mola"))}
    out["note"] = ("HiRISE was averaged to 20 m before differencing with CTX. A step above 2 m between rungs is flagged; "
                   "the console marks seam pixels on the map and lists per-pair steps in the window provenance.")
    return out
