from __future__ import annotations


# Dust opacity classes: the single source of truth for the assessment,
# the /dust endpoints and the frontend threshold bands.
DUST_LEVELS = [
    {"level": "low", "min": 0.0, "max": 0.2},
    {"level": "moderate", "min": 0.2, "max": 0.5},
    {"level": "high", "min": 0.5, "max": 1.0},
    {"level": "very_high", "min": 1.0, "max": None},
]


def classify_dust(opacity: float) -> str:
    for band in DUST_LEVELS:
        if band["max"] is None or opacity < band["max"]:
            return band["level"]
    return DUST_LEVELS[-1]["level"]


def assess_environment(environment: dict) -> dict:
    dust = environment["dust"]
    thermal = environment["thermal"]

    opacity = float(dust["opacity"])
    dust_level = classify_dust(opacity)

    thermal_observations = thermal.get("observations", [])

    if thermal_observations:
        thermal_status = "historical_evidence_available"
        thermal_note = (
            "THEMIS IR-PBT provides historical brightness temperature "
            "observations, not direct physical surface temperature."
        )
    else:
        thermal_status = "no_historical_evidence"
        thermal_note = (
            "No nearby historical THEMIS IR-PBT observation was available."
        )

    warnings: list[str] = []

    if dust_level == "high":
        warnings.append("High modeled dust opacity may reduce visibility.")
    elif dust_level == "very_high":
        warnings.append(
            "Very high modeled dust opacity may significantly affect visibility."
        )

    if thermal_status == "no_historical_evidence":
        warnings.append(
            "Thermal assessment is limited because no nearby historical "
            "THEMIS observation was available."
        )

    return {
        "dust": {
            "opacity": opacity,
            "level": dust_level,
            "source": dust["source"],
        },
        "thermal": {
            "status": thermal_status,
            "source": thermal["source"],
            "measurement": thermal["measurement"],
            "note": thermal_note,
        },
        "warnings": warnings,
        "assessment_status": (
            "limited" if not thermal_observations else "evidence_available"
        ),
    }
