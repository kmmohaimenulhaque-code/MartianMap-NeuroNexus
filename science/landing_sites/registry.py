from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import math


@dataclass(frozen=True)
class LandingSite:
    site_id: str
    mission: str
    spacecraft: str
    landing_date: str
    region: str
    latitude_deg: float
    longitude_deg: float
    site_status: str
    source_url: str
    coordinate_provenance: str


class LandingSiteRegistry:
    """Validated NASA Mars landing-site registry."""

    def __init__(self, manifest_path: str | Path) -> None:
        self.manifest_path = Path(manifest_path)

        with self.manifest_path.open(encoding="utf-8") as f:
            payload = json.load(f)

        self._sites: dict[str, LandingSite] = {}

        for record in payload["sites"]:
            site = LandingSite(
                site_id=record["site_id"],
                mission=record["mission"],
                spacecraft=record["spacecraft"],
                landing_date=record["landing_date"],
                region=record["region"],
                latitude_deg=float(record["latitude_deg"]),
                longitude_deg=float(record["longitude_deg"]),
                site_status=record["site_status"],
                source_url=record["source_url"],
                coordinate_provenance=record["coordinate_provenance"],
            )

            self._validate(site)

            if site.site_id in self._sites:
                raise ValueError(
                    f"duplicate landing site: {site.site_id}"
                )

            self._sites[site.site_id] = site

    @staticmethod
    def _validate(site: LandingSite) -> None:
        if not -90.0 <= site.latitude_deg <= 90.0:
            raise ValueError(
                f"invalid latitude for {site.site_id}: "
                f"{site.latitude_deg}"
            )

        if not 0.0 <= site.longitude_deg < 360.0:
            raise ValueError(
                f"invalid longitude for {site.site_id}: "
                f"{site.longitude_deg}"
            )

        if not site.source_url:
            raise ValueError(
                f"missing source URL for {site.site_id}"
            )

    def get(self, site_id: str) -> LandingSite:
        return self._sites[site_id]

    def all(self) -> tuple[LandingSite, ...]:
        return tuple(self._sites.values())

    def find(self, text: str) -> tuple[LandingSite, ...]:
        needle = text.casefold()

        return tuple(
            site
            for site in self._sites.values()
            if needle in site.site_id.casefold()
            or needle in site.mission.casefold()
            or needle in site.spacecraft.casefold()
            or needle in site.region.casefold()
        )

    def nearest(
        self,
        latitude_deg: float,
        longitude_deg: float,
        radius_km: float | None = None,
    ) -> tuple[LandingSite, ...]:
        """
        Return landing sites ordered by great-circle distance.

        Mars mean radius used here:
        3389.5 km.
        """

        radius_km_mars = 3389.5

        lat1 = math.radians(latitude_deg)
        lon1 = math.radians(longitude_deg)

        results = []

        for site in self._sites.values():
            lat2 = math.radians(site.latitude_deg)
            lon2 = math.radians(site.longitude_deg)

            dlat = lat2 - lat1
            dlon = math.atan2(
                math.sin(lon2 - lon1),
                math.cos(lon2 - lon1),
            )

            a = (
                math.sin(dlat / 2) ** 2
                + math.cos(lat1)
                * math.cos(lat2)
                * math.sin(dlon / 2) ** 2
            )

            c = 2 * math.atan2(
                math.sqrt(a),
                math.sqrt(max(0.0, 1.0 - a)),
            )

            distance_km = radius_km_mars * c

            if radius_km is None or distance_km <= radius_km:
                results.append((distance_km, site))

        results.sort(key=lambda item: item[0])

        return tuple(site for _, site in results)
