from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from science.thermal.themis_pbt import ThemisPBTReader

PLAN = ROOT / "data/indexes/themis/metadata/mars_seasonal_sampling_plan.jsonl"
RAW = Path("/scratch/themis/raw")
OUT = ROOT / "data/indexes/themis/metadata/mars_seasonal_thermal.jsonl"

OUT.parent.mkdir(parents=True, exist_ok=True)

def footprint_center(r):
    lat = (r["minimum_latitude"] + r["maximum_latitude"]) / 2
    lon = (r["westernmost_longitude"] + r["easternmost_longitude"]) / 2
    return lat, lon

total = 0
valid = 0
invalid = 0

with PLAN.open() as src, OUT.open("w") as dst:
    for line in src:
        r = json.loads(line)
        total += 1

        path = RAW / r["archive_path"]

        try:
            reader = ThemisPBTReader(path)

            lat, lon = footprint_center(r)

            sample = reader.sample_latlon(lat, lon)

            if not sample.get("valid"):
                invalid += 1
                continue

            record = {
                "latitude_deg": sample["latitude_deg"],
                "longitude_deg": sample["longitude_deg"],
                "brightness_temperature_k": sample["brightness_temperature_k"],
                "brightness_temperature_c": sample["brightness_temperature_c"],
                "measurement": "BRIGHTNESS_TEMPERATURE",
                "unit": "KELVIN",
                "product_id": r["product_id"],
                "archive_path": r["archive_path"],
                "observation_start": r["start_time"],
                "solar_longitude_deg": r["solar_longitude"],
                "local_solar_time_hours": r["local_time"],
                "resolution_m": sample["resolution_m"],
                "spatial_cell_lat": r["cell_lat"],
                "spatial_cell_lon": r["cell_lon"],
                "ls_bin": r["ls_bin"],
                "source": "NASA THEMIS IR-PBT",
                "status": "historical_brightness_temperature",
            }

            dst.write(json.dumps(record, separators=(",", ":")) + "\n")
            valid += 1

        except Exception as e:
            invalid += 1

        if total % 500 == 0:
            print(
                f"Processed {total:,} | "
                f"valid {valid:,} | invalid {invalid:,}",
                flush=True,
            )

print("\n" + "=" * 72)
print("MARS-WIDE THEMIS THERMAL EXTRACTION COMPLETE")
print("=" * 72)
print(f"Products processed : {total:,}")
print(f"Valid measurements : {valid:,}")
print(f"Invalid/null       : {invalid:,}")
print(f"Output             : {OUT}")
print("=" * 72)

if valid:
    print("🟢 REAL MARS BRIGHTNESS-TEMPERATURE DATASET CREATED")
