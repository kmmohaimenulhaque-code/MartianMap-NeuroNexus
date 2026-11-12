from __future__ import annotations

from dataclasses import dataclass
from math import cos, radians, sqrt
from typing import Iterable


@dataclass(frozen=True)
class MarsPlace:
    """Named geographic feature on Mars."""

    name: str
    feature_type: str
    latitude: float
    longitude: float
    diameter_km: float | None = None
    description: str | None = None
    source: str = "team-derived test registry"


class MarsGazetteer:
    """
    Spatial registry for named Martian geographic features.

    The initial registry is deliberately tiny and test-oriented.
    Production entries will come from authoritative Mars feature
    catalogues with provenance and source identifiers.
    """

    def __init__(
        self,
        places: Iterable[MarsPlace] | None = None,
    ) -> None:
        self._places = list(places or [])

    @staticmethod
    def normalize_longitude(longitude: float) -> float:
        return longitude % 360.0

    @staticmethod
    def _validate_latitude(latitude: float) -> None:
        if not -90.0 <= latitude <= 90.0:
            raise ValueError(
                "latitude must be between -90 and 90 degrees"
            )

    def add(self, place: MarsPlace) -> None:
        self._validate_latitude(place.latitude)

        if not 0.0 <= place.longitude < 360.0:
            place = MarsPlace(
                name=place.name,
                feature_type=place.feature_type,
                latitude=place.latitude,
                longitude=self.normalize_longitude(place.longitude),
                diameter_km=place.diameter_km,
                description=place.description,
                source=place.source,
            )

        self._places.append(place)

    def all(self) -> list[MarsPlace]:
        return list(self._places)

    def find(self, name: str) -> list[MarsPlace]:
        query = name.strip().casefold()

        if not query:
            return []

        return [
            place
            for place in self._places
            if query in place.name.casefold()
        ]

    def nearby(
        self,
        latitude: float,
        longitude: float,
        *,
        radius_km: float = 100.0,
    ) -> list[tuple[MarsPlace, float]]:
        """
        Return places within radius_km using a local spherical approximation.
        """

        self._validate_latitude(latitude)

        if radius_km < 0:
            raise ValueError("radius_km must be >= 0")

        longitude = self.normalize_longitude(longitude)

        mars_radius_km = 3389.5

        results: list[tuple[MarsPlace, float]] = []

        lat1 = radians(latitude)
        lon1 = radians(longitude)

        for place in self._places:
            lat2 = radians(place.latitude)
            lon2 = radians(place.longitude)

            dlat = lat2 - lat1
            dlon = lon2 - lon1

            # Wrap longitude across the 0/360 meridian.
            if dlon > 3.141592653589793:
                dlon -= 2.0 * 3.141592653589793
            elif dlon < -3.141592653589793:
                dlon += 2.0 * 3.141592653589793

            x = dlon * cos((lat1 + lat2) / 2.0)
            y = dlat

            distance_km = mars_radius_km * sqrt(
                x * x + y * y
            )

            if distance_km <= radius_km:
                results.append((place, distance_km))

        results.sort(key=lambda item: item[1])

        return results

    def at(
        self,
        latitude: float,
        longitude: float,
        *,
        tolerance_km: float = 10.0,
    ) -> list[tuple[MarsPlace, float]]:
        """Find named features within a coordinate tolerance."""

        return self.nearby(
            latitude,
            longitude,
            radius_km=tolerance_km,
        )


# Small test registry.
#
# These are test fixtures only. Production data must come from an
# authoritative Mars feature catalogue and retain its original identifiers.
TEST_PLACES = [
    MarsPlace(
        name="Olympus Mons",
        feature_type="volcano",
        latitude=18.65,
        longitude=226.2,
        diameter_km=624.0,
        source="team-derived test fixture",
    ),
    MarsPlace(
        name="Valles Marineris",
        feature_type="canyon_system",
        latitude=-14.0,
        longitude=290.5,
        diameter_km=None,
        source="team-derived test fixture",
    ),
    MarsPlace(
        name="Gale Crater",
        feature_type="impact_crater",
        latitude=-5.4,
        longitude=137.8,
        diameter_km=154.0,
        source="team-derived test fixture",
    ),
]
