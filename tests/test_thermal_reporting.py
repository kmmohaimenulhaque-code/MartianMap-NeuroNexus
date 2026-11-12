import pytest

from science.thermal.engine.thermal_engine import (
    NeuroNexusThermalEngine,
)
from science.weather.models.mars_environment import (
    MarsEnvironmentEngine,
)


def _observation(
    temperature_k,
    *,
    latitude=0.0,
    longitude=0.0,
    day_night=None,
    year="2024",
    solar_longitude=30.0,
):
    observation = {
        "latitude_deg": latitude,
        "longitude_deg": longitude,
        "brightness_temperature_k": temperature_k,
        "solar_longitude_deg": solar_longitude,
        "local_solar_time_hours": 6.5,
        "observation_start": f"{year}-01-01T00:00:00",
    }
    if day_night is not None:
        observation["day_night"] = day_night
    return observation


def _engine(rows):
    engine = NeuroNexusThermalEngine.__new__(NeuroNexusThermalEngine)
    engine.rows = rows
    return engine


def test_landing_site_report_calculates_temperature_statistics_and_coverage():
    engine = _engine(
        [
            _observation(200.0, day_night="day"),
            _observation(220.0, day_night="night", year="2023"),
            _observation(240.0, day_night="DAY", year="2022"),
        ]
    )

    report = engine.landing_site_report(
        latitude_deg=0.0,
        longitude_deg=0.0,
        radius_km=10.0,
        nearest_limit=1,
    )

    assert report["thermal"]["min_k"] == 200.0
    assert report["thermal"]["max_k"] == 240.0
    assert report["thermal"]["mean_k"] == pytest.approx(220.0)
    assert report["thermal"]["min_c"] == pytest.approx(-73.15)
    assert report["thermal"]["max_c"] == pytest.approx(-33.15)
    assert report["thermal"]["mean_c"] == pytest.approx(-53.15)
    assert report["coverage"]["observation_count"] == 3
    assert report["coverage"]["valid_sample_count"] == 3
    assert report["landing_site"]["search_radius_km"] == 10.0
    assert report["coverage"]["observation_years"] == ["2022", "2023", "2024"]
    assert report["thermal"]["day_night"]["day"]["sample_count"] == 2
    assert report["thermal"]["day_night"]["night"]["sample_count"] == 1


def test_no_matching_observations_keep_nearest_compatibility_and_null_statistics():
    engine = _engine(
        [_observation(210.0, longitude=5.0)]
    )

    report = engine.landing_site_report(
        latitude_deg=0.0,
        longitude_deg=0.0,
        radius_km=10.0,
        nearest_limit=1,
    )

    assert report["coverage"]["observation_count"] == 0
    assert report["coverage"]["valid_sample_count"] == 0
    assert report["thermal"]["min_k"] is None
    assert report["thermal"]["max_k"] is None
    assert report["thermal"]["mean_k"] is None
    assert report["thermal"]["min_c"] is None
    assert report["thermal"]["max_c"] is None
    assert report["thermal"]["mean_c"] is None
    assert len(report["nearest_observations"]) == 1


class _Gazetteer:
    def nearest(self, **kwargs):
        return None


class _Thermal:
    def landing_site_report(self, **kwargs):
        return {
            "status": "historical_themis_report",
            "source": "NASA THEMIS IR-PBT",
            "measurement_note": "Historical brightness temperature.",
            "thermal": {
                "min_k": 200.0,
                "max_k": 240.0,
                "mean_k": 220.0,
                "min_c": -73.15,
                "max_c": -33.15,
                "mean_c": -53.15,
            },
            "coverage": {
                "observation_count": 3,
                "years": 2,
                "observation_years": ["2023", "2024"],
                "seasonal_bins": 2,
                "seasonal_bins_total": 24,
                "seasonal_coverage_fraction": 2 / 24,
            },
            "landing_site": {"search_radius_km": 25.0},
            "nearest_observations": [
                {"brightness_temperature_k": 220.0}
            ],
        }


class _Weather:
    def get_conditions(self, **kwargs):
        return {"dust": {"opacity": 0.1}, "solar": {}}


class _Terrain:
    def assess(self, **kwargs):
        return {}


def test_environment_preserves_nearest_observations_and_exposes_summary():
    engine = MarsEnvironmentEngine.__new__(MarsEnvironmentEngine)
    engine.gazetteer = _Gazetteer()
    engine.thermal = _Thermal()
    engine.weather = _Weather()
    engine.terrain = _Terrain()

    state = engine.get_environment(
        latitude=0.0,
        longitude=0.0,
        sol=1,
    )

    thermal = state["thermal"]
    assert thermal["observations"] == [{"brightness_temperature_k": 220.0}]
    assert thermal["historical_summary"]["min_k"] == 200.0
    assert thermal["historical_summary"]["coverage"]["sample_count"] == 3
    assert thermal["historical_summary"]["coverage"]["search_radius_km"] == 25.0
