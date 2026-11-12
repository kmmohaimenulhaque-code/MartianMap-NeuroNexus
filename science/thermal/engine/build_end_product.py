from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from science.thermal.engine.confidence import ThermalEvidence, score


SOURCE = ROOT / "data/indexes/themis/metadata/mars_seasonal_thermal.jsonl"
OUT = ROOT / "data/indexes/themis/final/neuronexus_thermal_observations.jsonl"


def circular_gap(values):
    if len(values) < 2:
        return 360.0

    values = sorted(v % 360.0 for v in values)

    gaps = [
        values[i + 1] - values[i]
        for i in range(len(values) - 1)
    ]

    gaps.append(values[0] + 360.0 - values[-1])

    return max(gaps)


def color_for_temperature(k):
    """
    Visualization-only normalized thermal value.

    Keeps the physical measurement in Kelvin while providing
    a deterministic 0..1 value for the renderer.
    """

    lo = 140.0
    hi = 260.0

    normalized = (k - lo) / (hi - lo)
    return max(0.0, min(1.0, normalized))


rows = [
    json.loads(line)
    for line in SOURCE.open()
    if line.strip()
]

groups = defaultdict(list)

for row in rows:
    cell = (
        row["spatial_cell_lat"],
        row["spatial_cell_lon"],
    )
    groups[cell].append(row)


OUT.parent.mkdir(parents=True, exist_ok=True)

written = 0

with OUT.open("w") as dst:

    for cell, observations in groups.items():

        ls_values = [
            r["solar_longitude_deg"]
            for r in observations
        ]

        lst_values = [
            r["local_solar_time_hours"]
            for r in observations
        ]

        years = {
            r["observation_start"][:4]
            for r in observations
            if r.get("observation_start")
        }

        evidence = ThermalEvidence(
            observation_count=len(observations),
            seasonal_bins=len({
                int(r["solar_longitude_deg"] // 15)
                for r in observations
            }),
            largest_ls_gap_deg=circular_gap(ls_values),
            spatial_cells=1,
            years=len(years),
            lst_span_hours=(
                max(lst_values) - min(lst_values)
                if lst_values else inf
            ),
        )

        confidence = score(evidence)

        for r in observations:

            k = r["brightness_temperature_k"]

            final = {
                **r,

                # Explicitly visualization-derived.
                "thermal_visualization": {
                    "normalized_temperature": color_for_temperature(k),
                    "scale_min_k": 140.0,
                    "scale_max_k": 260.0,
                },

                # Evidence strength, NOT measurement accuracy.
                "evidence": {
                    **confidence,
                    "observation_count": evidence.observation_count,
                    "seasonal_bins": evidence.seasonal_bins,
                    "largest_ls_gap_deg": round(
                        evidence.largest_ls_gap_deg, 3
                    ),
                    "years": evidence.years,
                    "local_time_span_hours": round(
                        evidence.lst_span_hours, 3
                    ),
                },
            }

            dst.write(
                json.dumps(final, separators=(",", ":"))
                + "\n"
            )

            written += 1


print("=" * 72)
print("NEURONEXUS THERMAL END PRODUCT")
print("=" * 72)
print(f"Input observations : {len(rows):,}")
print(f"Output observations: {written:,}")
print(f"Spatial cells      : {len(groups):,}")
print(f"Output             : {OUT}")
print("=" * 72)
print("🟢 THERMAL ENGINE + EVIDENCE ENGINE READY")
