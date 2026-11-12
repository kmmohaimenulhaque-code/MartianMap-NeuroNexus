from __future__ import annotations

from typing import Any


class ThemisThermalValidator:
    """Validate historical THEMIS thermal observations."""

    VALID_DAY_NIGHT = {"day", "night", "unknown"}

    def validate(self, observation: dict[str, Any]) -> dict[str, Any]:
        errors: list[str] = []

        latitude = observation.get("latitude_deg")
        longitude = observation.get("longitude_deg")

        if latitude is None or not -90 <= float(latitude) <= 90:
            errors.append("Invalid latitude.")

        if longitude is None or not -180 <= float(longitude) <= 360:
            errors.append("Invalid longitude.")

        temperature_k = observation.get("temperature_k")

        if temperature_k is not None:
            temperature_k = float(temperature_k)

            if temperature_k <= 0:
                errors.append("Temperature in kelvin must be greater than zero.")

        temperature_c = observation.get("temperature_c")

        if temperature_c is not None and temperature_k is not None:
            expected_c = float(temperature_k) - 273.15

            if abs(float(temperature_c) - expected_c) > 0.01:
                errors.append(
                    "Kelvin/Celsius temperature values are inconsistent."
                )

        day_night = observation.get("day_night")

        if day_night is not None and day_night not in self.VALID_DAY_NIGHT:
            errors.append("Invalid day/night classification.")

        return {
            "valid": not errors,
            "errors": errors,
        }
