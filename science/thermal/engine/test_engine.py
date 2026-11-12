from pathlib import Path
from thermal_engine import NeuroNexusThermalEngine

ROOT = Path(__file__).resolve().parents[3]

engine = NeuroNexusThermalEngine(
    ROOT / "data/indexes/themis/final/parquet/neuronexus_thermal_observations.parquet"
)

summary = engine.coverage_summary()

print("=" * 72)
print("NEURONEXUS THERMAL ENGINE")
print("=" * 72)
print(summary)

results = engine.nearest(
    latitude_deg=-3.0,
    longitude_deg=137.0,
    solar_longitude_deg=90.0,
    limit=3,
)

print("\nNEAREST OBSERVATIONS:")
for r in results:
    print(
        r["product_id"],
        f"{r['brightness_temperature_k']:.2f} K",
        f"spatial={r['spatial_distance_km']:.2f} km",
        f"Ls={r['solar_longitude_deg']:.2f}°",
    )

print("=" * 72)
print("🟢 ENGINE QUERY TEST COMPLETE")
