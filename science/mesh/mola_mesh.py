from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from science.terrain.mola_terrain import TerrainWindow


MARS_RADIUS_M = 3_389_500.0


@dataclass(frozen=True)
class TerrainMesh:
    """Mars-centered triangular terrain mesh."""

    vertices_m: np.ndarray
    faces: np.ndarray
    latitudes_deg: np.ndarray
    longitudes_deg: np.ndarray

    @property
    def vertex_count(self) -> int:
        return int(self.vertices_m.shape[0])

    @property
    def face_count(self) -> int:
        return int(self.faces.shape[0])


class MolaMeshGenerator:
    """
    Convert a MOLA terrain window into a Mars-centered triangular mesh.

    Coordinates use:
        X = R cos(lat) cos(lon)
        Y = R cos(lat) sin(lon)
        Z = R sin(lat)

    where R = Mars mean radius + MOLA elevation.
    """

    def __init__(
        self,
        mars_radius_m: float = MARS_RADIUS_M,
    ) -> None:
        if mars_radius_m <= 0:
            raise ValueError("mars_radius_m must be > 0")

        self.mars_radius_m = float(mars_radius_m)

    def generate(
        self,
        window: TerrainWindow,
    ) -> TerrainMesh:
        elevation = np.asarray(
            window.elevations_m,
            dtype=np.float64,
        )

        if elevation.ndim != 2:
            raise ValueError("elevation grid must be 2D")

        rows, columns = elevation.shape

        if rows < 2 or columns < 2:
            raise ValueError(
                "terrain window must be at least 2x2"
            )

        latitudes = np.asarray(
            window.latitudes,
            dtype=np.float64,
        )

        longitudes = np.asarray(
            window.longitudes,
            dtype=np.float64,
        )

        if len(latitudes) != rows:
            raise ValueError(
                "latitude axis does not match elevation rows"
            )

        if len(longitudes) != columns:
            raise ValueError(
                "longitude axis does not match elevation columns"
            )

        lat_grid, lon_grid = np.meshgrid(
            latitudes,
            longitudes,
            indexing="ij",
        )

        lat_rad = np.deg2rad(lat_grid)
        lon_rad = np.deg2rad(lon_grid)

        radius = self.mars_radius_m + elevation

        x = radius * np.cos(lat_rad) * np.cos(lon_rad)
        y = radius * np.cos(lat_rad) * np.sin(lon_rad)
        z = radius * np.sin(lat_rad)

        vertices = np.column_stack(
            (
                x.ravel(),
                y.ravel(),
                z.ravel(),
            )
        )

        faces = []

        for row in range(rows - 1):
            for column in range(columns - 1):
                top_left = row * columns + column
                top_right = top_left + 1
                bottom_left = (row + 1) * columns + column
                bottom_right = bottom_left + 1

                faces.append(
                    (
                        top_left,
                        top_right,
                        bottom_left,
                    )
                )

                faces.append(
                    (
                        top_right,
                        bottom_right,
                        bottom_left,
                    )
                )

        faces_array = np.asarray(
            faces,
            dtype=np.int64,
        )

        return TerrainMesh(
            vertices_m=vertices,
            faces=faces_array,
            latitudes_deg=latitudes,
            longitudes_deg=longitudes,
        )

    def export_obj(
        self,
        mesh: TerrainMesh,
        path: str | Path,
    ) -> Path:
        path = Path(path)
        path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        with path.open("w", encoding="utf-8") as handle:
            handle.write(
                "# NeuroNexus MOLA terrain mesh\n"
            )
            handle.write(
                "# Coordinates: Mars-centered Cartesian metres\n"
            )

            for vertex in mesh.vertices_m:
                handle.write(
                    f"v {vertex[0]:.6f} "
                    f"{vertex[1]:.6f} "
                    f"{vertex[2]:.6f}\n"
                )

            for face in mesh.faces:
                # OBJ indices are 1-based.
                handle.write(
                    f"f {face[0] + 1} "
                    f"{face[1] + 1} "
                    f"{face[2] + 1}\n"
                )

        return path
