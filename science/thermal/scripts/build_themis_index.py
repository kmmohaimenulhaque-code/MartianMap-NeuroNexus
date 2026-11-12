from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from science.thermal.themis_pbt import ThemisPBTReader


GRID = (
    (0.10, 0.10), (0.50, 0.10), (0.90, 0.10),
    (0.10, 0.50), (0.50, 0.50), (0.90, 0.50),
    (0.10, 0.90), (0.50, 0.90), (0.90, 0.90),
)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python build_themis_index.py PRODUCT.IMG [PRODUCT.IMG ...]")
        return 1

    records = []

    for raw_path in sys.argv[1:]:
        path = Path(raw_path)
        print(f"Reading: {path}")

        reader = ThemisPBTReader(path)
        m = reader.metadata

        for fx, fy in GRID:
            latitude = (
                m.minimum_latitude
                + fy * (m.maximum_latitude - m.minimum_latitude)
            )
            longitude = (
                m.westernmost_longitude
                + fx * (m.easternmost_longitude - m.westernmost_longitude)
            )

            result = reader.sample_latlon(latitude, longitude)

            if not result["valid"]:
                continue

            lst = result["local_solar_time_hours"]

            record = {
                "latitude_deg": result["latitude_deg"],
                "longitude_deg": result["longitude_deg"],
                "brightness_temperature_k": result["brightness_temperature_k"],
                "brightness_temperature_c": result["brightness_temperature_c"],
                "observation_start": result["observation_start"],
                "observation_stop": result["observation_stop"],
                "solar_longitude_deg": result["solar_longitude_deg"],
                "local_solar_time_hours": lst,
                "day_night": (
                    "day"
                    if lst is not None and 6.0 <= lst < 18.0
                    else "night"
                    if lst is not None
                    else "unknown"
                ),
                "product_id": result["product_id"],
                "resolution_m": result["resolution_m"],
                "measurement": "brightness_temperature",
                "unit": "K",
                "source": "NASA THEMIS IR-PBT",
                "status": "historical_observation",
            }

            records.append(record)

            print(
                f"  OK {record['brightness_temperature_k']:.3f} K"
                f" @ ({latitude:.4f}, {longitude:.4f})"
            )

    output = Path(
        "data/indexes/themis/themis_thermal_observations.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("w", encoding="utf-8") as handle:
        json.dump(records, handle, indent=2)

    print()
    print("=== INDEX COMPLETE ===")
    print(f"Observations: {len(records)}")
    print(f"Output: {output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
