import math

import pytest

from science.usgs.arcgis import MAP_WKT, build_wab_sync_url, extent_for
from science.usgs.robinson import MARS_2000_SPHERE_RADIUS_M, forward

pyproj = pytest.importorskip("pyproj")


def test_robinson_matches_proj_within_a_metre():
    from pyproj import CRS, Transformer

    transformer = Transformer.from_crs(
        CRS.from_proj4(f"+proj=longlat +R={MARS_2000_SPHERE_RADIUS_M} +no_defs"),
        CRS.from_proj4(f"+proj=robin +lon_0=0 +R={MARS_2000_SPHERE_RADIUS_M} +units=m +no_defs"),
        always_xy=True,
    )
    worst = 0.0
    for latitude in range(-88, 89, 4):
        for longitude in range(-175, 176, 11):
            mine = forward(longitude + 0.4, latitude + 0.3)
            reference = transformer.transform(longitude + 0.4, latitude + 0.3)
            worst = max(worst, abs(mine[0] - reference[0]), abs(mine[1] - reference[1]))
    assert worst < 1.0


def test_origin_and_hemispheres():
    assert forward(0.0, 0.0) == pytest.approx((0.0, 0.0), abs=1e-6)
    assert forward(10.0, 0.0)[0] > 0 and forward(-10.0, 0.0)[0] < 0
    assert forward(0.0, 10.0)[1] > 0 and forward(0.0, -10.0)[1] < 0


def test_sync_url_carries_extent_and_the_maps_own_wkt():
    payload = build_wab_sync_url([(-4.5895, 137.4417)], min_half_km=40.0)
    assert payload["url"].startswith("https://usgs.maps.arcgis.com/apps/webappviewer/index.html?id=")
    assert "extent=" in payload["url"] and "Robinson_clon0_Mars_2000_Sphere" in payload["url"].replace("%22", '"').replace("%2C", ",").replace("%5B", "[")
    extent = payload["extent"]
    assert extent["xmax"] - extent["xmin"] == pytest.approx(80000.0)
    assert extent["ymax"] - extent["ymin"] == pytest.approx(80000.0)


def test_extent_contains_every_route_coordinate():
    coordinates = [(-4.59, 137.44), (-4.72, 137.38), (-4.66, 137.52)]
    extent = extent_for(coordinates, min_half_m=5000.0)
    for latitude, longitude in coordinates:
        x, y = forward(longitude, latitude)
        assert extent["xmin"] <= x <= extent["xmax"]
        assert extent["ymin"] <= y <= extent["ymax"]


def test_antimeridian_route_is_refused_rather_than_mis_drawn():
    with pytest.raises(ValueError, match="180"):
        extent_for([(0.0, 179.0), (0.0, -179.0)])


def test_map_wkt_is_the_published_definition():
    assert 'PROJECTION["Robinson"]' in MAP_WKT and "3396190.0" in MAP_WKT
