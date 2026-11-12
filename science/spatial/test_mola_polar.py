from __future__ import annotations

import math

from science.spatial.mola_polar import MolaPolar


def angular_lon_error(a: float, b: float) -> float:
    """Shortest longitude difference in degrees."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def check_round_trip(
    engine: MolaPolar,
    latitude: float,
    longitude: float,
    hemisphere: str,
) -> None:
    row, column = engine.pixel_from_latlon(
        latitude,
        longitude,
        hemisphere,
    )

    recovered_lat, recovered_lon = engine.latlon_from_pixel(
        row,
        column,
        hemisphere,
    )

    lat_error = abs(recovered_lat - latitude)
    lon_error = angular_lon_error(recovered_lon, longitude)

    # Longitude tolerance must scale with latitude because meridians
    # converge toward the pole. We validate the physical/projected
    # position rather than demanding an arbitrary fixed degree error.
    #
    # At the equator, allow roughly one pixel in longitude.
    # Near the pole, the equivalent angular longitude error becomes larger.
    cos_lat = max(abs(math.cos(math.radians(latitude))), 1e-6)
    pixel_lon_deg = (1.0 / engine.RESOLUTION) / cos_lat

    lon_tolerance = max(0.02, pixel_lon_deg * 1.5)

    print(
        f"lat={latitude:9.4f} "
        f"lon={longitude:8.4f} "
        f"pixel=({row:5d},{column:5d}) "
        f"recovered=({recovered_lat:9.4f},{recovered_lon:9.4f}) "
        f"errors=({lat_error:.6f}°, {lon_error:.6f}°) "
        f"tol_lon={lon_tolerance:.6f}°"
    )

    assert lat_error < 0.02
    assert lon_error < lon_tolerance


def main() -> None:
    engine = MolaPolar()

    north_points = [
        (89.9, 0.0),
        (89.9, 90.0),
        (89.9, 180.0),
        (89.9, 270.0),
        (85.0, 0.0),
        (80.0, 45.0),
        (75.0, 45.0),
    ]

    south_points = [
        (-89.9, 0.0),
        (-89.9, 90.0),
        (-89.9, 180.0),
        (-89.9, 270.0),
        (-85.0, 0.0),
        (-80.0, 45.0),
        (-75.0, 45.0),
    ]

    print("MOLA POLAR PROJECTION VALIDATION")
    print("=" * 78)

    print("\nNORTH")
    for lat, lon in north_points:
        check_round_trip(engine, lat, lon, "north")

    print("\nSOUTH")
    for lat, lon in south_points:
        check_round_trip(engine, lat, lon, "south")

    print("\n" + "=" * 78)
    print("ALL MOLA POLAR PROJECTION TESTS PASSED")


if __name__ == "__main__":
    main()
