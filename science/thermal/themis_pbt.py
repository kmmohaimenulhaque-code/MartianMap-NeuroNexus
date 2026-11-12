from __future__ import annotations

import math
import re
import struct
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ThemisPBTMetadata:
    lines: int
    samples: int
    record_bytes: int
    label_records: int
    sample_type: str
    sample_bits: int
    null_constant: float
    offset: float
    scaling_factor: float
    radius_km: float
    center_longitude_deg: float
    map_scale_km: float
    sample_projection_offset: float
    line_projection_offset: float
    minimum_latitude: float
    maximum_latitude: float
    westernmost_longitude: float
    easternmost_longitude: float
    observation_start: str | None
    observation_stop: str | None
    solar_longitude_deg: float | None
    local_solar_time_hours: float | None


class ThemisPBTReader:
    """
    Reader for NASA THEMIS geometrically projected IR-PBT products.

    IR-PBT raster values are brightness temperatures in Kelvin.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)

        if not self.path.exists():
            raise FileNotFoundError(self.path)

        self.metadata = self._read_metadata()

    def _read_label(self) -> str:
        """
        Read the fixed-size PDS3 label.

        THEMIS PBT products store the label in complete PDS records.
        RECORD_BYTES and LABEL_RECORDS are discovered from the initial
        portion of the file using whitespace-tolerant matching.
        """
        with self.path.open("rb") as handle:
            header = handle.read(65536)

        text = header.decode("ascii", errors="replace")

        record_match = re.search(
            r"\bRECORD_BYTES\s*=\s*(\d+)",
            text,
            flags=re.IGNORECASE,
        )

        label_match = re.search(
            r"\bLABEL_RECORDS\s*=\s*(\d+)",
            text,
            flags=re.IGNORECASE,
        )

        if record_match is None:
            raise ValueError(
                "Could not find RECORD_BYTES in THEMIS PDS label."
            )

        if label_match is None:
            raise ValueError(
                "Could not find LABEL_RECORDS in THEMIS PDS label."
            )

        record_bytes = int(record_match.group(1))
        label_records = int(label_match.group(1))

        label_size = record_bytes * label_records

        if label_size <= 0:
            raise ValueError(
                f"Invalid PDS label size: {label_size}"
            )

        if label_size > len(header):
            raise ValueError(
                f"PDS label exceeds initial read: {label_size}"
            )

        return text[:label_size]

    @staticmethod
    def _value(label: str, key: str, cast=str):
        """
        Extract a PDS keyword.

        Uses the first occurrence because keywords such as OFFSET may
        appear in multiple PDS objects.
        """
        match = re.search(
            rf"\b{re.escape(key)}\s*=\s*([^\r\n]+)",
            label,
            flags=re.IGNORECASE,
        )

        if match is None:
            raise ValueError(
                f"Missing PDS label field: {key}"
            )

        value = match.group(1).strip()

        # Remove comments and trailing punctuation.
        value = value.split("/*", 1)[0].strip()
        value = value.rstrip(",").strip()

        # Remove surrounding quotes.
        value = value.strip('"').strip("'")

        return cast(value)

    @staticmethod
    def _object_value(
        label: str,
        object_name: str,
        key: str,
        cast=str,
    ):
        """
        Extract a keyword from a specific PDS OBJECT block.

        Needed because OFFSET occurs both in the image object and
        projection metadata.
        """
        object_match = re.search(
            rf"OBJECT\s*=\s*{re.escape(object_name)}\b"
            rf"(.*?)"
            rf"END_OBJECT\s*=\s*{re.escape(object_name)}\b",
            label,
            flags=re.IGNORECASE | re.DOTALL,
        )

        if object_match is None:
            raise ValueError(
                f"Missing PDS OBJECT: {object_name}"
            )

        return ThemisPBTReader._value(
            object_match.group(1),
            key,
            cast,
        )

    def _read_metadata(self) -> ThemisPBTMetadata:
        label = self._read_label()

        record_bytes = self._value(
            label,
            "RECORD_BYTES",
            int,
        )

        label_records = self._value(
            label,
            "LABEL_RECORDS",
            int,
        )

        lines = self._object_value(
            label,
            "IMAGE",
            "LINES",
            int,
        )

        samples = self._object_value(
            label,
            "IMAGE",
            "LINE_SAMPLES",
            int,
        )

        sample_type = self._object_value(
            label,
            "IMAGE",
            "SAMPLE_TYPE",
        )

        sample_bits = self._object_value(
            label,
            "IMAGE",
            "SAMPLE_BITS",
            int,
        )

        null_constant = self._object_value(
            label,
            "IMAGE",
            "NULL_CONSTANT",
            float,
        )

        offset = self._object_value(
            label,
            "IMAGE",
            "OFFSET",
            float,
        )

        scaling_factor = self._object_value(
            label,
            "IMAGE",
            "SCALING_FACTOR",
            float,
        )

        return ThemisPBTMetadata(
            lines=lines,
            samples=samples,
            record_bytes=record_bytes,
            label_records=label_records,
            sample_type=sample_type,
            sample_bits=sample_bits,
            null_constant=null_constant,
            offset=offset,
            scaling_factor=scaling_factor,
            radius_km=self._value(
                label,
                "A_AXIS_RADIUS",
                float,
            ),
            center_longitude_deg=self._value(
                label,
                "CENTER_LONGITUDE",
                float,
            ),
            map_scale_km=self._value(
                label,
                "MAP_SCALE",
                float,
            ),
            sample_projection_offset=self._value(
                label,
                "SAMPLE_PROJECTION_OFFSET",
                float,
            ),
            line_projection_offset=self._value(
                label,
                "LINE_PROJECTION_OFFSET",
                float,
            ),
            minimum_latitude=self._value(
                label,
                "MINIMUM_LATITUDE",
                float,
            ),
            maximum_latitude=self._value(
                label,
                "MAXIMUM_LATITUDE",
                float,
            ),
            westernmost_longitude=self._value(
                label,
                "WESTERNMOST_LONGITUDE",
                float,
            ),
            easternmost_longitude=self._value(
                label,
                "EASTERNMOST_LONGITUDE",
                float,
            ),
            observation_start=self._value(
                label,
                "START_TIME",
                str,
            ),
            observation_stop=self._value(
                label,
                "STOP_TIME",
                str,
            ),
            solar_longitude_deg=self._value(
                label,
                "SOLAR_LONGITUDE",
                float,
            ),
            local_solar_time_hours=self._value(
                label,
                "LOCAL_TIME",
                float,
            ),
        )

    @property
    def data_offset(self) -> int:
        return (
            self.metadata.record_bytes
            * self.metadata.label_records
        )

    def pixel_to_latlon(
        self,
        line: float,
        sample: float,
    ) -> tuple[float, float]:
        m = self.metadata

        x_km = (
            (sample - m.sample_projection_offset)
            * m.map_scale_km
        )

        y_km = (
            (m.line_projection_offset - line)
            * m.map_scale_km
        )

        latitude_rad = y_km / m.radius_km
        latitude_deg = math.degrees(latitude_rad)

        cos_lat = math.cos(latitude_rad)

        if abs(cos_lat) < 1e-12:
            raise ValueError(
                "Invalid sinusoidal longitude calculation."
            )

        longitude_deg = (
            m.center_longitude_deg
            + math.degrees(
                x_km / (m.radius_km * cos_lat)
            )
        )

        return latitude_deg, longitude_deg

    def latlon_to_pixel(
        self,
        latitude_deg: float,
        longitude_deg: float,
    ) -> tuple[float, float]:
        m = self.metadata

        latitude_rad = math.radians(latitude_deg)

        delta_lon_rad = math.radians(
            longitude_deg - m.center_longitude_deg
        )

        x_km = (
            m.radius_km
            * math.cos(latitude_rad)
            * delta_lon_rad
        )

        y_km = m.radius_km * latitude_rad

        sample = (
            x_km / m.map_scale_km
            + m.sample_projection_offset
        )

        line = (
            m.line_projection_offset
            - y_km / m.map_scale_km
        )

        return line, sample

    def _validate_pixel(
        self,
        line: int,
        sample: int,
    ) -> None:
        m = self.metadata

        if not 1 <= line <= m.lines:
            raise IndexError(
                "THEMIS line outside raster."
            )

        if not 1 <= sample <= m.samples:
            raise IndexError(
                "THEMIS sample outside raster."
            )

    def read_pixel(
        self,
        line: int,
        sample: int,
    ) -> float | None:
        m = self.metadata

        self._validate_pixel(line, sample)

        if m.sample_type != "PC_REAL" or m.sample_bits != 32:
            raise ValueError(
                "Unsupported THEMIS sample format: "
                f"{m.sample_type}/{m.sample_bits}"
            )

        pixel_index = (
            (line - 1) * m.samples
            + (sample - 1)
        )

        byte_offset = (
            self.data_offset
            + pixel_index * 4
        )

        with self.path.open("rb") as handle:
            handle.seek(byte_offset)
            raw = handle.read(4)

        if len(raw) != 4:
            raise EOFError(
                "Incomplete THEMIS pixel."
            )

        value = struct.unpack(
            "<f",
            raw,
        )[0]

        if (
            value == m.null_constant
            or not math.isfinite(value)
        ):
            return None

        return (
            value * m.scaling_factor
            + m.offset
        )

    def sample_latlon(
        self,
        latitude_deg: float,
        longitude_deg: float,
    ) -> dict:
        m = self.metadata

        if not (
            m.minimum_latitude
            <= latitude_deg
            <= m.maximum_latitude
        ):
            return {
                "valid": False,
                "reason": "latitude_outside_product",
            }

        if not (
            m.westernmost_longitude
            <= longitude_deg
            <= m.easternmost_longitude
        ):
            return {
                "valid": False,
                "reason": "longitude_outside_product",
            }

        line_f, sample_f = self.latlon_to_pixel(
            latitude_deg,
            longitude_deg,
        )

        line = int(round(line_f))
        sample = int(round(sample_f))

        if not (
            1 <= line <= m.lines
            and 1 <= sample <= m.samples
        ):
            return {
                "valid": False,
                "reason": "pixel_outside_raster",
            }

        temperature_k = self.read_pixel(
            line,
            sample,
        )

        return {
            "valid": temperature_k is not None,
            "latitude_deg": latitude_deg,
            "longitude_deg": longitude_deg,
            "line": line,
            "sample": sample,
            "brightness_temperature_k": temperature_k,
            "brightness_temperature_c": (
                temperature_k - 273.15
                if temperature_k is not None
                else None
            ),
            "measurement": "brightness_temperature",
            "unit": "K",
            "product_id": self.path.stem,
            "source": "NASA THEMIS IR-PBT",
            "observation_start": m.observation_start,
            "observation_stop": m.observation_stop,
            "solar_longitude_deg": m.solar_longitude_deg,
            "local_solar_time_hours": m.local_solar_time_hours,
            "resolution_m": m.map_scale_km * 1000.0,
        }
