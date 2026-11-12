from __future__ import annotations


def classify_dust(opacity: float) -> str:
    if opacity < 0.2:
        return "low"
    if opacity < 0.5:
        return "moderate"
    if opacity < 1.0:
        return "high"
    return "very_high"


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
