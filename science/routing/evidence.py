"""Extensible science-evidence abstraction.

Only data actually ingested by the project is used. Nothing is invented:
if a source is not ingested for a window it is reported as UNAVAILABLE.
Future layers (CTX, HiRISE, CRISM, SHARAD, Mars 2020 ...) plug in as new
collectors returning EvidenceItem objects.
"""

from __future__ import annotations

import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
GAZETTEER_PATH = ROOT / "data" / "processed" / "gazetteer" / "mars_nomenclature_center_pts.parquet"
THEMIS_PATH = ROOT / "data" / "indexes" / "themis" / "final" / "parquet" / "neuronexus_thermal_observations.parquet"


@dataclass
class EvidenceItem:
    id: str
    source: str
    measurement_type: str
    name: str
    latitude_deg: float
    longitude_deg: float
    engagement_radius_km: float
    status: str
    provenance: str
    url: str | None = None
    timestamp: str | None = None
    confidence: str | None = None
    coverage: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_LOCK = threading.Lock()
_SINGLETONS: dict[str, Any] = {}


def _singleton(name: str, factory: Callable[[], Any]) -> Any:
    with _LOCK:
        if name not in _SINGLETONS:
            _SINGLETONS[name] = factory()
        return _SINGLETONS[name]


def _gazetteer():
    from science.gazetteer.usgs import USGSMarsGazetteer

    return _singleton("gazetteer", lambda: USGSMarsGazetteer(GAZETTEER_PATH))


def _thermal():
    from science.thermal.engine.thermal_engine import NeuroNexusThermalEngine

    return _singleton("thermal", lambda: NeuroNexusThermalEngine(THEMIS_PATH))


def collect_usgs_features(lat: float, lon: float, radius_km: float) -> list[EvidenceItem]:
    features = _gazetteer().nearby(latitude=lat, longitude=lon, radius_km=radius_km)
    items: list[EvidenceItem] = []
    for feature in features:
        try:
            diameter = float(feature.get("diameter_km") or 0.0)
        except (TypeError, ValueError):
            diameter = 0.0
        items.append(
            EvidenceItem(
                id=f"usgs-{feature.get('feature_name')}",
                source="USGS Gazetteer of Planetary Nomenclature (IAU)",
                measurement_type="named_landform_centre_point",
                name=str(feature.get("feature_name")),
                latitude_deg=float(feature["latitude_deg"]),
                longitude_deg=float(feature["longitude_deg"]) % 360.0,
                engagement_radius_km=round(min(max(diameter / 2.0, 0.5), 5.0), 3),
                status="NASA REFERENCE",
                provenance="USGS/IAU catalogued feature centre point; proximity is not a confirmed science target.",
                url=feature.get("usgs_feature_url"),
                timestamp=feature.get("approval_date"),
                extra={"feature_type": feature.get("feature_type"), "diameter_km": feature.get("diameter_km")},
            )
        )
    return items


def collect_themis(lat: float, lon: float, radius_km: float, limit: int = 200) -> list[EvidenceItem]:
    rows = _thermal().seasonal_history(latitude_deg=lat, longitude_deg=lon, radius_km=radius_km)
    rows = sorted(rows, key=lambda r: r.get("spatial_distance_km", 0.0))[:limit]
    items: list[EvidenceItem] = []
    for index, row in enumerate(rows):
        evidence = row.get("evidence") or {}
        items.append(
            EvidenceItem(
                id=f"themis-{row.get('product_id')}-{index}",
                source="NASA THEMIS IR-PBT (Mars Odyssey)",
                measurement_type="historical_brightness_temperature",
                name=str(row.get("product_id")),
                latitude_deg=float(row["latitude_deg"]),
                longitude_deg=float(row["longitude_deg"]) % 360.0,
                engagement_radius_km=1.0,
                status="NASA OBSERVED",
                provenance="Historical orbital brightness-temperature observation; not a live measurement.",
                url="https://themis.asu.edu/",
                timestamp=row.get("observation_start"),
                confidence=evidence.get("label"),
                coverage={"resolution_m": row.get("resolution_m")},
                extra={
                    "brightness_temperature_k": row.get("brightness_temperature_k"),
                    "solar_longitude_deg": row.get("solar_longitude_deg"),
                    "local_solar_time_hours": row.get("local_solar_time_hours"),
                },
            )
        )
    return items


COLLECTORS: dict[str, Callable[[float, float, float], list[EvidenceItem]]] = {
    "usgs_iau_features": collect_usgs_features,
    "nasa_themis_observations": collect_themis,
}

NOT_INGESTED = ["MRO CTX", "MRO HiRISE", "MRO CRISM mineralogy", "MRO SHARAD", "Mars 2020 in-situ"]


def collect_evidence(lat: float, lon: float, radius_km: float) -> tuple[list[EvidenceItem], dict[str, Any]]:
    items: list[EvidenceItem] = []
    status: dict[str, Any] = {}
    for name, collector in COLLECTORS.items():
        try:
            found = collector(lat, lon, radius_km)
            items.extend(found)
            status[name] = {"status": "AVAILABLE", "count": len(found)}
        except Exception as exc:  # data file missing / corrupt -> honest UNAVAILABLE
            status[name] = {"status": "UNAVAILABLE", "error": str(exc)[:200]}
    for name in NOT_INGESTED:
        status[name] = {"status": "NOT INGESTED"}
    return items, status
