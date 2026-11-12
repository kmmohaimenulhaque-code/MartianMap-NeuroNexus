from __future__ import annotations

from math import atan2, cos, radians, sin, sqrt
from typing import Any


MARS_RADIUS_KM = 3389.5


def angular_difference_deg(a: float, b: float) -> float:
    """Smallest circular difference between two angles."""

    difference = abs(float(a) - float(b))
    return min(difference, 360.0 - difference)


def mars_distance_km(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    """Great-circle distance on Mars."""

    phi1 = radians(lat1)
    phi2 = radians(lat2)
    delta_phi = radians(lat2 - lat1)
    delta_lambda = radians(lon2 - lon1)

    a = (
        sin(delta_phi / 2) ** 2
        + cos(phi1)
        * cos(phi2)
        * sin(delta_lambda / 2) ** 2
    )

    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return MARS_RADIUS_KM * c


class ThemisThermalMatcher:
    """Find historical observations near a requested location/season."""

    def rank(
        self,
        observations: list[dict[str, Any]],
        *,
        latitude_deg: float,
        longitude_deg: float,
        solar_longitude_deg: float | None = None,
    ) -> list[dict[str, Any]]:

        ranked: list[dict[str, Any]] = []

        for observation in observations:
            obs_lat = float(observation["latitude_deg"])
            obs_lon = float(observation["longitude_deg"])

            spatial_distance = mars_distance_km(
                latitude_deg,
                longitude_deg,
                obs_lat,
                obs_lon,
            )

            seasonal_distance = None

            if (
                solar_longitude_deg is not None
                and observation.get("solar_longitude_deg") is not None
            ):
                seasonal_distance = angular_difference_deg(
                    solar_longitude_deg,
                    float(observation["solar_longitude_deg"]),
                )

            item = dict(observation)

            item["spatial_distance_km"] = spatial_distance
            item["seasonal_distance_deg"] = seasonal_distance

            ranked.append(item)

        ranked.sort(
            key=lambda item: (
                item["spatial_distance_km"],
                item["seasonal_distance_deg"]
                if item["seasonal_distance_deg"] is not None
                else 999.0,
            )
        )

        return ranked
