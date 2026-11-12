from __future__ import annotations

from dataclasses import dataclass
from math import atan2, cos, radians, sin, sqrt


MARS_RADIUS_KM = 3396.0


@dataclass(frozen=True)
class RoutePoint:
    latitude_deg: float
    longitude_deg: float
    label: str = "WAYPOINT"


def normalize_longitude(longitude_deg: float) -> float:
    return float(longitude_deg) % 360.0


def haversine_km(
    latitude1_deg: float,
    longitude1_deg: float,
    latitude2_deg: float,
    longitude2_deg: float,
    *,
    radius_km: float = MARS_RADIUS_KM,
) -> float:
    """
    Great-circle surface distance on a spherical Mars model.

    Longitude is wrapped to the shortest angular difference so that
    routes crossing 0/360 degrees remain correct.
    """

    latitude1_rad = radians(latitude1_deg)
    latitude2_rad = radians(latitude2_deg)

    delta_latitude_rad = (
        latitude2_rad - latitude1_rad
    )

    delta_longitude_deg = (
        (longitude2_deg - longitude1_deg + 180.0)
        % 360.0
    ) - 180.0

    delta_longitude_rad = radians(
        delta_longitude_deg
    )

    a = (
        sin(delta_latitude_rad / 2.0) ** 2
        + cos(latitude1_rad)
        * cos(latitude2_rad)
        * sin(delta_longitude_rad / 2.0) ** 2
    )

    a = min(
        1.0,
        max(0.0, a),
    )

    return float(
        2.0
        * radius_km
        * atan2(
            sqrt(a),
            sqrt(1.0 - a),
        )
    )


def validate_point(point: RoutePoint) -> None:
    if not (
        -88.0 <= point.latitude_deg <= 88.0
    ):
        raise ValueError(
            "Route latitude must be between "
            f"-88 and 88 degrees: "
            f"{point.latitude_deg}"
        )

    if not (
        0.0 <= point.longitude_deg < 360.0
    ):
        raise ValueError(
            "Route longitude must be between "
            f"0 and 360 degrees: "
            f"{point.longitude_deg}"
        )


def build_route_plan(
    points: list[RoutePoint],
) -> dict:
    """
    Build a user-defined multi-point Mars route.

    Distance uses only Haversine geometry between consecutive
    waypoints. No corridor, A*, or route-wide MOLA search occurs here.
    """

    if len(points) < 2:
        raise ValueError(
            "At least two route points are required."
        )

    if len(points) > 32:
        raise ValueError(
            "A maximum of 32 route points is supported."
        )

    for point in points:
        validate_point(point)

    legs: list[dict] = []
    planned_distance_km = 0.0

    for index, (start, end) in enumerate(
        zip(points, points[1:]),
        start=1,
    ):
        distance_km = haversine_km(
            latitude1_deg=start.latitude_deg,
            longitude1_deg=start.longitude_deg,
            latitude2_deg=end.latitude_deg,
            longitude2_deg=end.longitude_deg,
        )

        planned_distance_km += distance_km

        legs.append(
            {
                "index": index,
                "start_label": start.label,
                "end_label": end.label,
                "start": {
                    "latitude_deg": start.latitude_deg,
                    "longitude_deg": start.longitude_deg,
                },
                "end": {
                    "latitude_deg": end.latitude_deg,
                    "longitude_deg": end.longitude_deg,
                },
                "distance_km": distance_km,
            }
        )

    displacement_km = haversine_km(
        latitude1_deg=points[0].latitude_deg,
        longitude1_deg=points[0].longitude_deg,
        latitude2_deg=points[-1].latitude_deg,
        longitude2_deg=points[-1].longitude_deg,
    )

    extension_km = max(
        0.0,
        planned_distance_km - displacement_km,
    )

    extension_percent = (
        (extension_km / displacement_km) * 100.0
        if displacement_km > 0.0
        else 0.0
    )

    return {
        "displacement_km": displacement_km,
        "planned_route_km": planned_distance_km,
        "extension_km": extension_km,
        "extension_percent": extension_percent,
        "point_count": len(points),
        "leg_count": len(legs),
        "waypoints": [
            {
                "index": index,
                "label": point.label,
                "latitude_deg": point.latitude_deg,
                "longitude_deg": point.longitude_deg,
            }
            for index, point in enumerate(
                points,
                start=1,
            )
        ],
        "legs": legs,
        "coordinates": [
            [
                point.latitude_deg,
                point.longitude_deg,
            ]
            for point in points
        ],
    }
