from __future__ import annotations

from typing import Any


class MasterMarsInterpreter:
    """
    Interprets a MasterMarsQuery result into an AI-ready evidence report.

    This layer does not invent missing measurements.
    It summarizes validated evidence, derived survival indicators,
    uncertainty, and provenance.
    """

    def interpret(self, context: dict[str, Any]) -> dict[str, Any]:
        terrain = context.get("terrain", {})
        thermal = context.get("thermal", {})
        missions = context.get("missions", {})
        survival = context.get("survival", {})
        provenance = context.get("provenance", [])

        findings: list[str] = []
        limitations: list[str] = []

        # ---------------------------------------------------------
        # TERRAIN
        # ---------------------------------------------------------

        if terrain.get("elevation_m") is not None:
            findings.append(
                f"Terrain elevation is {float(terrain['elevation_m']):.1f} m."
            )

        if terrain.get("slope_deg") is not None:
            findings.append(
                f"Local slope is {float(terrain['slope_deg']):.3f} degrees."
            )

        if terrain.get("roughness_m") is not None:
            findings.append(
                f"Local terrain roughness is approximately "
                f"{float(terrain['roughness_m']):.1f} m."
            )

        # ---------------------------------------------------------
        # THERMAL
        # ---------------------------------------------------------

        temperature_c = thermal.get("surface_temperature_c")

        if temperature_c is not None:
            findings.append(
                f"Observed surface temperature is "
                f"{float(temperature_c):.1f} °C."
            )
        else:
            findings.append(
                "No validated local thermal observation is currently "
                "available in the query context."
            )

            limitations.append(
                "Surface temperature was not inferred because no "
                "validated thermal observation was available."
            )

        # ---------------------------------------------------------
        # MISSIONS
        # ---------------------------------------------------------

        landing_sites = missions.get("landing_sites", [])

        if landing_sites:
            nearest = landing_sites[0]

            spacecraft = nearest.get("spacecraft", "unknown spacecraft")
            distance = nearest.get("distance_km")

            if distance is not None:
                findings.append(
                    f"The nearest registered landing site is "
                    f"{spacecraft}, approximately {float(distance):.1f} km away."
                )
            else:
                findings.append(
                    f"A registered landing site is associated with "
                    f"{spacecraft}."
                )

        # ---------------------------------------------------------
        # SURVIVAL
        # ---------------------------------------------------------

        indicators = survival.get("indicators", {})

        slope_risk = indicators.get("slope_risk")
        if slope_risk:
            findings.append(
                f"The survival engine classifies local slope risk as "
                f"{slope_risk} under its current heuristic."
            )

        roughness_risk = indicators.get("roughness_risk")
        if roughness_risk:
            findings.append(
                f"The survival engine classifies local roughness risk as "
                f"{roughness_risk} under its current heuristic."
            )

        thermal_status = indicators.get("thermal_data")
        if thermal_status == "unknown":
            limitations.append(
                "Thermal suitability cannot currently be assessed from "
                "a validated local observation."
            )

        # Preserve survival-engine limitations.
        for limitation in survival.get("limitations", []):
            if limitation not in limitations:
                limitations.append(limitation)

        # ---------------------------------------------------------
        # SUMMARY
        # ---------------------------------------------------------

        if survival.get("status") == "derived":
            summary = (
                "The query produced a derived Mars survival context from "
                "the available terrain, mission, and thermal evidence. "
                + " ".join(findings)
            )
        else:
            summary = " ".join(findings)

        return {
            "summary": summary,
            "findings": findings,
            "survival": survival,
            "limitations": limitations,
            "evidence": {
                "terrain": terrain,
                "thermal": thermal,
                "missions": missions,
            },
            "provenance": provenance,
        }
