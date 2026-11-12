from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush
from math import atan2, cos, radians, sin, sqrt

import numpy as np

from science.terrain.derivatives import MOLA128Derivatives
from science.terrain.mola128_window import MOLA128WindowExtractor


MARS_RADIUS_KM = 3396.0


@dataclass(frozen=True)
class MarsRoute:
    coordinates: list[tuple[float, float]]
    distance_km: float
    terrain_cost: float
    max_slope_deg: float
    mean_slope_deg: float
    mean_roughness_m: float


class MarsRoutePlanner:
    def __init__(
        self,
        extractor: MOLA128WindowExtractor | None = None,
        derivatives: MOLA128Derivatives | None = None,
    ):
        self.extractor = extractor or MOLA128WindowExtractor()
        self.derivatives = derivatives or MOLA128Derivatives()

    @staticmethod
    def haversine_km(
        lat1: float,
        lon1: float,
        lat2: float,
        lon2: float,
    ) -> float:
        lat1_r = radians(lat1)
        lat2_r = radians(lat2)
        dlat = lat2_r - lat1_r
        dlon = radians(lon2 - lon1)

        a = (
            sin(dlat / 2.0) ** 2
            + cos(lat1_r)
            * cos(lat2_r)
            * sin(dlon / 2.0) ** 2
        )

        return 2.0 * MARS_RADIUS_KM * atan2(
            sqrt(a),
            sqrt(1.0 - a),
        )

    @staticmethod
    def _nearest_index(
        values: np.ndarray,
        target: float,
    ) -> int:
        return int(np.argmin(np.abs(values - target)))

    @staticmethod
    def _heuristic(
        row: int,
        col: int,
        goal_row: int,
        goal_col: int,
    ) -> float:
        return sqrt(
            (goal_row - row) ** 2
            + (goal_col - col) ** 2
        )

    @staticmethod
    def _movement_cost(
        current_elevation: float,
        next_elevation: float,
        slope_deg: float,
        roughness_m: float,
    ) -> float:
        elevation_change = abs(
            next_elevation - current_elevation
        )

        return (
            1.0
            + 0.05 * slope_deg
            + 0.002 * roughness_m
            + 0.0001 * elevation_change
        )

    def plan(
        self,
        start_latitude: float,
        start_longitude: float,
        end_latitude: float,
        end_longitude: float,
        corridor_width_km: float = 20.0,
        corridor_height_km: float = 20.0,
    ) -> MarsRoute:
        center_latitude = (
            start_latitude + end_latitude
        ) / 2.0

        center_longitude = (
            start_longitude + end_longitude
        ) / 2.0

        width_km = max(
            corridor_width_km,
            self.haversine_km(
                start_latitude,
                start_longitude,
                start_latitude,
                end_longitude,
            ),
        )

        height_km = max(
            corridor_height_km,
            self.haversine_km(
                start_latitude,
                start_longitude,
                end_latitude,
                start_longitude,
            ),
        )

        window = self.extractor.extract(
            center_latitude,
            center_longitude,
            width_km,
            height_km,
        )

        derivatives = self.derivatives.compute(window)

        start_row = self._nearest_index(
            window.latitudes_deg,
            start_latitude,
        )
        start_col = self._nearest_index(
            window.longitudes_deg,
            start_longitude % 360.0,
        )

        goal_row = self._nearest_index(
            window.latitudes_deg,
            end_latitude,
        )
        goal_col = self._nearest_index(
            window.longitudes_deg,
            end_longitude % 360.0,
        )

        rows, cols = window.elevations_m.shape

        frontier: list[
            tuple[float, int, int]
        ] = []

        heappush(
            frontier,
            (
                self._heuristic(
                    start_row,
                    start_col,
                    goal_row,
                    goal_col,
                ),
                start_row,
                start_col,
            ),
        )

        came_from: dict[
            tuple[int, int],
            tuple[int, int] | None,
        ] = {
            (start_row, start_col): None
        }

        cost_so_far: dict[
            tuple[int, int],
            float,
        ] = {
            (start_row, start_col): 0.0
        }

        neighbors = (
            (-1, 0),
            (1, 0),
            (0, -1),
            (0, 1),
            (-1, -1),
            (-1, 1),
            (1, -1),
            (1, 1),
        )

        while frontier:
            _, row, col = heappop(frontier)

            if (row, col) == (goal_row, goal_col):
                break

            for dr, dc in neighbors:
                next_row = row + dr
                next_col = col + dc

                if not (
                    0 <= next_row < rows
                    and 0 <= next_col < cols
                ):
                    continue

                step_cost = self._movement_cost(
                    float(window.elevations_m[row, col]),
                    float(window.elevations_m[next_row, next_col]),
                    float(
                        derivatives.slope_deg[
                            next_row,
                            next_col,
                        ]
                    ),
                    float(
                        derivatives.roughness_m[
                            next_row,
                            next_col,
                        ]
                    ),
                )

                if dr != 0 and dc != 0:
                    step_cost *= 1.41421356237

                new_cost = (
                    cost_so_far[(row, col)]
                    + step_cost
                )

                node = (next_row, next_col)

                if (
                    node not in cost_so_far
                    or new_cost < cost_so_far[node]
                ):
                    cost_so_far[node] = new_cost

                    priority = (
                        new_cost
                        + self._heuristic(
                            next_row,
                            next_col,
                            goal_row,
                            goal_col,
                        )
                    )

                    heappush(
                        frontier,
                        (
                            priority,
                            next_row,
                            next_col,
                        ),
                    )

                    came_from[node] = (
                        row,
                        col,
                    )

        goal = (goal_row, goal_col)

        if goal not in came_from:
            raise RuntimeError(
                "No route found through the available terrain window."
            )

        path: list[tuple[int, int]] = []

        current = goal

        while current is not None:
            path.append(current)
            current = came_from[current]

        path.reverse()

        coordinates = [
            (
                float(window.latitudes_deg[row]),
                float(window.longitudes_deg[col]),
            )
            for row, col in path
        ]

        slopes = np.array(
            [
                derivatives.slope_deg[row, col]
                for row, col in path
            ],
            dtype=np.float64,
        )

        roughness = np.array(
            [
                derivatives.roughness_m[row, col]
                for row, col in path
            ],
            dtype=np.float64,
        )

        distance_km = 0.0

        for (lat1, lon1), (lat2, lon2) in zip(
            coordinates,
            coordinates[1:],
        ):
            distance_km += self.haversine_km(
                lat1,
                lon1,
                lat2,
                lon2,
            )

        return MarsRoute(
            coordinates=coordinates,
            distance_km=distance_km,
            terrain_cost=cost_so_far[goal],
            max_slope_deg=float(slopes.max()),
            mean_slope_deg=float(slopes.mean()),
            mean_roughness_m=float(roughness.mean()),
        )
