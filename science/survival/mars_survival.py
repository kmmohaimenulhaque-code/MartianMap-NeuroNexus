from __future__ import annotations

from typing import Any


class MarsSurvivalEngine:
    """Transparent survival indicators derived from validated Mars data."""

    def evaluate(self, context: dict[str, Any]) -> dict[str, Any]:
        terrain = context.get("terrain", {})
        thermal = context.get("thermal", {})
        missions = context.get("missions", {})

        slope = terrain.get("slope_deg")
        roughness = terrain.get("roughness_m")

        findings: list[str] = []
        indicators: dict[str, Any] = {}

        if slope is not None:
            slope = float(slope)

            if slope < 5:
                slope_risk = "low"
            elif slope < 15:
                slope_risk = "moderate"
            else:
                slope_risk = "high"

            indicators["slope_risk"] = slope_risk
            findings.append(
                f"Local slope is {slope:.2f}°, "
                f"corresponding to {slope_risk} terrain slope risk."
            )
        else:
            indicators["slope_risk"] = "unknown"

        if roughness is not None:
            roughness = float(roughness)

            if roughness < 5:
                roughness_risk = "low"
            elif roughness < 20:
                roughness_risk = "moderate"
            else:
                roughness_risk = "high"

            indicators["roughness_risk"] = roughness_risk
            findings.append(
                f"Measured local roughness is approximately "
                f"{roughness:.1f} m, giving {roughness_risk} "
                f"roughness risk under the current heuristic."
            )
        else:
            indicators["roughness_risk"] = "unknown"

        landing_sites = missions.get("landing_sites", [])
        indicators["nearby_landing_sites"] = len(landing_sites)

        if landing_sites:
            nearest = landing_sites[0]
            findings.append(
                f"Nearest registered landing site is "
                f"{nearest.get('spacecraft', 'unknown spacecraft')} "
                f"at approximately "
                f"{nearest.get('distance_km', 'unknown')} km."
            )

        if thermal.get("surface_temperature_c") is not None:
            indicators["thermal_data"] = "available"
            findings.append(
                "A validated local thermal observation is available."
            )
        else:
            indicators["thermal_data"] = "unknown"
            findings.append(
                "Local surface temperature is currently unknown because "
                "no validated thermal observation is attached to this query."
            )

        return {
            "status": "derived",
            "indicators": indicators,
            "findings": findings,
            "limitations": [
                "Risk categories are transparent heuristics, not mission certification.",
                "Missing thermal observations are not inferred or fabricated.",
                "Atmospheric, radiation, water-ice, and subsurface evidence are still required for a complete survival assessment.",
            ],
        }
