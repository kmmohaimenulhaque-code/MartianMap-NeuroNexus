"""Deterministic multi-objective route candidate generation.

Pipeline (no LLM involvement):
  1. bounded local MOLA 128 ppd window around start/destination (cached)
  2. slope/roughness derivatives (science.terrain.derivatives)
  3. coarsened 8-connected planning graph
  4. Dijkstra (scipy.sparse.csgraph) per objective / weight vector
  5. polyline simplification to <= 32 vertices (route-editor limit)
  6. metrics re-sampled on the exact simplified polyline at native resolution
  7. deduplication and Pareto (non-dominated) flagging
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Sequence

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from science.routing.evidence import EvidenceItem, collect_evidence
from science.routing.metrics import (
    METHODOLOGY,
    MARS_RADIUS_KM,
    REFERENCES,
    burden_density,
    densify,
    estimate_eva_hours,
    finite_or_none,
    haversine_km,
    pareto_flags,
    polyline_distance_km,
    summarise_samples,
    terrain_risk_proxy,
    unwrap_longitude,
)
from science.routing.objectives import (
    OBJECTIVE_KEYS,
    PRESETS,
    SCALARISATION,
    SPECIAL_CANDIDATES,
    normalise_weights,
    weights_equal,
)

ALGORITHM_VERSION = "neuronexus-route-mo 1.0.0"
MAX_WINDOW_KM = 120.0
# Long traverses are split into legs whose own planning window fits the
# 120 km bound. A window is ~1.7x the leg length (35 % margin each side), so
# 60 km legs give ~102 km windows. Each leg loads only its own small MOLA
# window; no global grid is ever loaded.
SEGMENT_TARGET_KM = 60.0
MAX_SEGMENTS = 80
MAX_ROUTE_VERTICES = 32
DEFAULT_MAX_CELLS = 140
DEFAULT_EVA_PACE_KMH = 2.5
DEFAULT_ASCENT_M_PER_H = 600.0


@dataclass
class TerrainGrid:
    latitudes_deg: np.ndarray  # rows, strictly descending, regular
    longitudes_deg: np.ndarray  # cols, strictly ascending, regular, unwrapped
    elevation_m: np.ndarray
    slope_deg: np.ndarray
    roughness_m: np.ndarray
    slope_max_deg: np.ndarray | None = None
    source: str = "NASA MOLA MEGDR 128 pixels/degree"
    dataset: str | None = "MGS-M-MOLA-5-MEGDR-L3-V1.0"
    pixels_per_degree: float | None = 128.0
    coarsen_factor: int = 1

    @classmethod
    def from_elevation(cls, latitudes_deg, longitudes_deg, elevation_m, **kwargs) -> "TerrainGrid":
        from science.terrain.derivatives import MOLA128Derivatives

        lat = np.asarray(latitudes_deg, dtype=float)
        lon = np.asarray(longitudes_deg, dtype=float)
        elev = np.asarray(elevation_m, dtype=float)
        deriv = MOLA128Derivatives()._compute(
            elevation=elev, latitudes_deg=lat, longitudes_deg=lon, center_latitude_deg=float(lat.mean())
        )
        return cls(lat, lon, elev, deriv.slope_deg, deriv.roughness_m, **kwargs)

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation_m.shape

    @property
    def dlat(self) -> float:
        return float(self.latitudes_deg[0] - self.latitudes_deg[1])

    @property
    def dlon(self) -> float:
        return float(self.longitudes_deg[1] - self.longitudes_deg[0])

    @property
    def center_longitude(self) -> float:
        return float(self.longitudes_deg.mean())

    @property
    def cell_km(self) -> float:
        lat = math.radians(float(self.latitudes_deg.mean()))
        return MARS_RADIUS_KM * math.radians(max(self.dlat, self.dlon * math.cos(lat)))

    def index_of(self, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        lat = np.asarray(lat, dtype=float)
        lon = np.array([unwrap_longitude(v, self.center_longitude) for v in np.atleast_1d(lon)], dtype=float)
        rows = np.rint((self.latitudes_deg[0] - lat) / self.dlat).astype(int)
        cols = np.rint((lon - self.longitudes_deg[0]) / self.dlon).astype(int)
        valid = (rows >= 0) & (rows < self.shape[0]) & (cols >= 0) & (cols < self.shape[1])
        return np.clip(rows, 0, self.shape[0] - 1), np.clip(cols, 0, self.shape[1] - 1), valid

    def sample(self, lat, lon) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        rows, cols, valid = self.index_of(lat, lon)
        elev = self.elevation_m[rows, cols].astype(float)
        slope = self.slope_deg[rows, cols].astype(float)
        rough = self.roughness_m[rows, cols].astype(float)
        valid = valid & np.isfinite(elev) & np.isfinite(slope) & np.isfinite(rough)
        return elev, slope, rough, valid

    def coarsen(self, max_cells: int) -> "TerrainGrid":
        rows, cols = self.shape
        f = max(1, int(math.ceil(max(rows, cols) / float(max_cells))))
        if f == 1:
            return TerrainGrid(
                self.latitudes_deg, self.longitudes_deg, self.elevation_m, self.slope_deg, self.roughness_m,
                self.slope_deg, self.source, self.dataset, self.pixels_per_degree, 1,
            )
        r, c = rows // f, cols // f

        def block(a, fn):
            return fn(a[: r * f, : c * f].reshape(r, f, c, f), axis=(1, 3))

        return TerrainGrid(
            latitudes_deg=self.latitudes_deg[: r * f].reshape(r, f).mean(axis=1),
            longitudes_deg=self.longitudes_deg[: c * f].reshape(c, f).mean(axis=1),
            elevation_m=block(self.elevation_m, np.mean),
            slope_deg=block(self.slope_deg, np.mean),
            roughness_m=block(self.roughness_m, np.mean),
            slope_max_deg=block(self.slope_deg, np.max),
            source=self.source,
            dataset=self.dataset,
            pixels_per_degree=self.pixels_per_degree,
            coarsen_factor=f,
        )


# ---------------------------------------------------------------- terrain


@lru_cache(maxsize=24)
def _cached_mola_grid(lat: float, lon: float, width_km: float, height_km: float) -> TerrainGrid:
    from science.terrain.derivatives import MOLA128Derivatives
    from science.terrain.mola128_window import MOLA128WindowExtractor

    window = MOLA128WindowExtractor().extract(
        latitude_deg=lat, longitude_deg=lon, width_km=width_km, height_km=height_km
    )
    derivatives = MOLA128Derivatives().compute(window)
    lons = np.degrees(np.unwrap(np.radians(np.asarray(window.longitudes_deg, dtype=float))))
    lons = lons + (unwrap_longitude(lons[0], lon) - lons[0])
    return TerrainGrid(
        latitudes_deg=np.asarray(window.latitudes_deg, dtype=float),
        longitudes_deg=lons,
        elevation_m=window.elevations_m.astype(float),
        slope_deg=derivatives.slope_deg.astype(float),
        roughness_m=derivatives.roughness_m.astype(float),
    )


def planning_window(coordinates: Sequence[tuple[float, float]]) -> dict[str, float]:
    """Bounding window (km) around a set of coordinates with a margin."""
    lat0 = float(coordinates[0][0])
    lon0 = float(coordinates[0][1])
    lats = np.array([c[0] for c in coordinates], dtype=float)
    lons = np.array([unwrap_longitude(c[1], lon0) for c in coordinates], dtype=float)
    center_lat = float((lats.min() + lats.max()) / 2.0)
    center_lon = float(((lons.min() + lons.max()) / 2.0) % 360.0)
    span_north_km = MARS_RADIUS_KM * math.radians(float(lats.max() - lats.min()))
    span_east_km = MARS_RADIUS_KM * math.cos(math.radians(center_lat)) * math.radians(float(lons.max() - lons.min()))
    direct_km = float(haversine_km(lats[0], lons[0], lats[-1], lons[-1]))
    margin = max(2.0, 0.35 * max(direct_km, span_north_km, span_east_km))
    width = max(4.0, span_east_km + 2.0 * margin)
    height = max(4.0, span_north_km + 2.0 * margin)
    if max(width, height) > MAX_WINDOW_KM:
        raise ValueError(
            f"Bounded planning window would be {max(width, height):.1f} km; the limit is {MAX_WINDOW_KM:.0f} km. "
            "Choose a closer destination or add an intermediate waypoint."
        )
    return {
        "center_latitude_deg": round(center_lat, 6),
        "center_longitude_deg": round(center_lon, 6),
        "width_km": round(width, 3),
        "height_km": round(height, 3),
        "margin_km": round(margin, 3),
    }


def load_grid(window: dict[str, float]) -> TerrainGrid:
    return _cached_mola_grid(
        round(window["center_latitude_deg"], 5),
        round(window["center_longitude_deg"], 5),
        round(window["width_km"], 2),
        round(window["height_km"], 2),
    )


# ---------------------------------------------------------------- graph


class PlanningGraph:
    def __init__(self, grid: TerrainGrid, *, pace_kmh: float, ascent_m_per_h: float,
                 science_field: np.ndarray, haven_km: np.ndarray):
        self.grid = grid
        rows, cols = grid.shape
        self.rows, self.cols = rows, cols
        self.n = rows * cols
        index = np.arange(self.n).reshape(rows, cols)
        lat_rad = np.radians(grid.latitudes_deg)
        dy = MARS_RADIUS_KM * math.radians(grid.dlat)
        dx_row = MARS_RADIUS_KM * np.cos(lat_rad) * math.radians(grid.dlon)
        src, dst, length = [], [], []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                r0, r1 = max(0, -dr), rows - max(0, dr)
                c0, c1 = max(0, -dc), cols - max(0, dc)
                a = index[r0:r1, c0:c1]
                b = index[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
                dx = np.broadcast_to(dx_row[r0:r1, None], a.shape)
                src.append(a.ravel())
                dst.append(b.ravel())
                length.append(np.hypot(dr * dy, dc * dx).ravel())
        self.i = np.concatenate(src)
        self.j = np.concatenate(dst)
        self.length = np.concatenate(length)

        slope = grid.slope_deg.ravel()
        slope_max = (grid.slope_max_deg if grid.slope_max_deg is not None else grid.slope_deg).ravel()
        rough = grid.roughness_m.ravel()
        elev = grid.elevation_m.ravel()
        s = 0.5 * (slope[self.i] + slope[self.j])
        smax = np.maximum(slope_max[self.i], slope_max[self.j])
        r = 0.5 * (rough[self.i] + rough[self.j])
        gain = np.maximum(elev[self.j] - elev[self.i], 0.0)
        sci = 0.5 * (science_field.ravel()[self.i] + science_field.ravel()[self.j])
        hav = 0.5 * (haven_km.ravel()[self.i] + haven_km.ravel()[self.j])
        L = self.length
        eva = L / pace_kmh + (gain / ascent_m_per_h if ascent_m_per_h > 0 else 0.0)
        self.costs: dict[str, np.ndarray] = {
            "distance": L,
            "eva": eva,
            "terrain": L * (0.05 + burden_density(s, r)),
            "science": L * (0.05 + 0.95 * (1.0 - sci)),
            "operational": L * (0.1 + np.minimum(hav / REFERENCES["operational_reference_km"], 1.0)),
            "risk": L * (1.0 + (s / 15.0) ** 3 + (smax / 15.0) ** 3 + (r / 50.0) ** 3),
        }
        bad = ~np.isfinite(elev[self.i]) | ~np.isfinite(elev[self.j])
        for key in self.costs:
            self.costs[key] = np.where(bad, 1e6 * L, self.costs[key])
        self._edge = None

    def node(self, lat: float, lon: float) -> int:
        rows, cols, _ = self.grid.index_of(np.array([lat]), np.array([lon]))
        return int(rows[0] * self.cols + cols[0])

    def shortest(self, cost: np.ndarray, source: int, target: int) -> list[int]:
        graph = csr_matrix((cost, (self.i, self.j)), shape=(self.n, self.n))
        _, predecessors = dijkstra(graph, directed=True, indices=source, return_predecessors=True)
        path = [target]
        while path[-1] != source:
            previous = int(predecessors[path[-1]])
            if previous < 0:
                raise ValueError("No connected path exists on the planning grid.")
            path.append(previous)
        return path[::-1]

    def path_totals(self, path: list[int]) -> dict[str, float]:
        if self._edge is None:
            self._edge = {(int(a), int(b)): k for k, (a, b) in enumerate(zip(self.i, self.j))}
        totals = {key: 0.0 for key in self.costs}
        for a, b in zip(path, path[1:]):
            k = self._edge[(a, b)]
            for key, cost in self.costs.items():
                totals[key] += float(cost[k])
        return totals

    def coordinates(self, path: list[int]) -> list[tuple[float, float]]:
        out = []
        for node in path:
            r, c = divmod(node, self.cols)
            out.append((float(self.grid.latitudes_deg[r]), float(self.grid.longitudes_deg[c])))
        return out


# ---------------------------------------------------------------- helpers


def _local_xy(coords: Sequence[tuple[float, float]]) -> np.ndarray:
    lat0 = math.radians(float(np.mean([c[0] for c in coords])))
    lon_ref = coords[0][1]
    return np.array(
        [
            (
                MARS_RADIUS_KM * math.cos(lat0) * math.radians(unwrap_longitude(lon, lon_ref) - lon_ref),
                MARS_RADIUS_KM * math.radians(lat),
            )
            for lat, lon in coords
        ]
    )


def _rdp(xy: np.ndarray, epsilon: float) -> list[int]:
    keep = {0, len(xy) - 1}
    stack = [(0, len(xy) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg = xy[b] - xy[a]
        norm = float(np.hypot(*seg))
        pts = xy[a + 1:b] - xy[a]
        if norm == 0:
            dist = np.hypot(pts[:, 0], pts[:, 1])
        else:
            dist = np.abs(seg[0] * pts[:, 1] - seg[1] * pts[:, 0]) / norm
        k = int(np.argmax(dist))
        if float(dist[k]) > epsilon:
            idx = a + 1 + k
            keep.add(idx)
            stack.extend([(a, idx), (idx, b)])
    return sorted(keep)


def simplify(coords: list[tuple[float, float]], cell_km: float, limit: int = MAX_ROUTE_VERTICES) -> tuple[list[tuple[float, float]], float]:
    if len(coords) <= 2:
        return coords, 0.0
    xy = _local_xy(coords)
    epsilon = 0.25 * cell_km
    while True:
        keep = _rdp(xy, epsilon)
        if len(keep) <= limit:
            return [coords[k] for k in keep], epsilon
        epsilon *= 1.6


def _field_distance_km(grid: TerrainGrid, lat: float, lon: float) -> np.ndarray:
    lat_grid, lon_grid = np.meshgrid(grid.latitudes_deg, grid.longitudes_deg, indexing="ij")
    return haversine_km(lat_grid, lon_grid, lat, lon)


def science_field(grid: TerrainGrid, evidence: list[EvidenceItem]) -> np.ndarray:
    field = np.zeros(grid.shape, dtype=float)
    for item in evidence:
        d = _field_distance_km(grid, item.latitude_deg, item.longitude_deg)
        field = np.maximum(field, np.exp(-((d / max(item.engagement_radius_km, 0.1)) ** 2)))
    return field


def haven_field(grid: TerrainGrid, havens: list[dict[str, Any]], start: tuple[float, float]) -> tuple[np.ndarray, str]:
    if havens:
        stack = [_field_distance_km(grid, float(h["latitude_deg"]), float(h["longitude_deg"])) for h in havens]
        return np.min(np.stack(stack), axis=0), "nearest Safe Haven"
    return _field_distance_km(grid, start[0], start[1]), "route start (no Safe Haven defined)"


def _distance_to_points_km(lat: np.ndarray, lon: np.ndarray, points: list[tuple[float, float]]) -> np.ndarray:
    if not points:
        return np.full(lat.shape, np.nan)
    return np.min(np.stack([haversine_km(lat, lon, p[0], p[1]) for p in points]), axis=0)


def evaluate_polyline(
    coordinates: list[tuple[float, float]],
    grid: TerrainGrid | None,
    *,
    pace_kmh: float,
    ascent_m_per_h: float,
    havens: list[dict[str, Any]],
    evidence: list[EvidenceItem] | None,
) -> dict[str, Any]:
    """Deterministic metrics for an exact polyline (candidate or manual route)."""
    distance = polyline_distance_km(coordinates)
    displacement = float(haversine_km(coordinates[0][0], coordinates[0][1], coordinates[-1][0], coordinates[-1][1]))
    spacing = max(0.05, (grid.cell_km if grid is not None else 0.25) * 0.5)
    lat, lon = densify(coordinates, spacing)
    if grid is not None:
        elev, slope, rough, valid = grid.sample(lat, lon)
    else:
        elev = slope = rough = np.full(lat.shape, np.nan)
        valid = np.zeros(lat.shape, dtype=bool)
    summary = summarise_samples(elevation=elev, slope=slope, roughness=rough, valid=valid)
    risk, risk_components = terrain_risk_proxy(
        max_slope_deg=summary["max_slope_deg"],
        p90_slope_deg=summary["p90_slope_deg"],
        max_roughness_m=summary["max_roughness_m"],
        elevation_gain_m=summary["elevation_gain_m"],
        elevation_loss_m=summary["elevation_loss_m"],
        distance_km=distance,
    )
    haven_points = [(float(h["latitude_deg"]), float(h["longitude_deg"])) for h in havens]
    reference = "nearest Safe Haven" if haven_points else "route start (no Safe Haven defined)"
    haven_d = _distance_to_points_km(lat, lon, haven_points or [coordinates[0]])
    ops = np.minimum(haven_d / REFERENCES["operational_reference_km"], 1.0)

    engaged: list[dict[str, Any]] = []
    if evidence:
        for item in evidence:
            d = float(np.min(haversine_km(lat, lon, item.latitude_deg, item.longitude_deg)))
            if d <= item.engagement_radius_km:
                engaged.append({
                    "id": item.id, "source": item.source, "measurement_type": item.measurement_type,
                    "name": item.name, "status": item.status, "min_distance_km": round(d, 3),
                    "latitude_deg": item.latitude_deg, "longitude_deg": item.longitude_deg,
                    "url": item.url, "timestamp": item.timestamp,
                })
    science_score = round(100.0 * len(engaged) / len(evidence), 2) if evidence else None

    return {
        "distance_km": round(distance, 4),
        "displacement_km": round(displacement, 4),
        "estimated_eva_hours": estimate_eva_hours(distance, summary["elevation_gain_m"], pace_kmh, ascent_m_per_h),
        "eva_pace_kmh": pace_kmh,
        "ascent_allowance_m_per_h": ascent_m_per_h,
        **{k: summary[k] for k in (
            "mean_slope_deg", "max_slope_deg", "p90_slope_deg", "mean_roughness_m", "max_roughness_m",
            "elevation_min_m", "elevation_max_m", "elevation_gain_m", "elevation_loss_m", "terrain_burden_score",
        )},
        "terrain_risk_proxy": risk,
        "terrain_risk_components": risk_components,
        "operational_burden_score": round(100.0 * float(np.mean(ops)), 3),
        "max_distance_from_safe_haven_km": round(float(np.max(haven_d)), 3),
        "operational_reference": reference,
        "science_opportunity_score": science_score,
        "science_evidence_count": len(engaged) if evidence else None,
        "science_evidence_available": len(evidence or []),
        "science_evidence": engaged,
        "data_support_score": summary["data_support_score"],
        "sample_count": summary["sample_count"],
        "sample_spacing_km": round(spacing, 4),
    }


def _point(value: dict[str, Any] | Sequence[float]) -> tuple[float, float]:
    if isinstance(value, dict):
        return float(value["latitude_deg"]), float(value["longitude_deg"]) % 360.0
    return float(value[0]), float(value[1]) % 360.0


def _collect(window: dict[str, float], include_science: bool, evidence: list[EvidenceItem] | None):
    if evidence is not None:
        return evidence, {"injected": {"status": "AVAILABLE", "count": len(evidence)}}
    if not include_science:
        return [], {"science": {"status": "DISABLED BY USER"}}
    radius = 0.5 * math.hypot(window["width_km"], window["height_km"])
    return collect_evidence(window["center_latitude_deg"], window["center_longitude_deg"], radius)


# ---------------------------------------------------------------- public API


def _plan_single_window(
    start: dict[str, Any],
    destination: dict[str, Any],
    *,
    weights: dict[str, Any] | None = None,
    eva_pace_kmh: float = DEFAULT_EVA_PACE_KMH,
    ascent_allowance_m_per_h: float = DEFAULT_ASCENT_M_PER_H,
    safe_havens: list[dict[str, Any]] | None = None,
    include_science: bool = True,
    grid: TerrainGrid | None = None,
    evidence: list[EvidenceItem] | None = None,
    max_cells: int = DEFAULT_MAX_CELLS,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    timing: dict[str, float] = {}
    a, b = _point(start), _point(destination)
    if haversine_km(a[0], a[1], b[0], b[1]) < 0.05:
        raise ValueError("Start and destination are closer than 50 m; nothing to plan.")
    havens = list(safe_havens or [])
    custom = normalise_weights(weights) if weights else None

    window = planning_window([a, b])
    t = time.perf_counter()
    fine = grid if grid is not None else load_grid(window)
    timing["terrain_sampling_ms"] = round((time.perf_counter() - t) * 1000, 2)

    t = time.perf_counter()
    items, evidence_status = _collect(window, include_science, evidence)
    timing["evidence_ms"] = round((time.perf_counter() - t) * 1000, 2)

    t = time.perf_counter()
    coarse = fine.coarsen(max_cells)
    sci = science_field(coarse, items)
    hav, _ = haven_field(coarse, havens, a)
    graph = PlanningGraph(coarse, pace_kmh=eva_pace_kmh, ascent_m_per_h=ascent_allowance_m_per_h,
                          science_field=sci, haven_km=hav)
    src, dst = graph.node(*a), graph.node(*b)
    if src == dst:
        raise ValueError("Start and destination fall in the same planning cell; move them further apart.")

    single: dict[str, list[int]] = {}
    for key in ("distance", "risk", *OBJECTIVE_KEYS):
        single[key] = graph.shortest(graph.costs[key], src, dst)
    optimum = {key: max(graph.path_totals(single[key])[key], 1e-9) for key in OBJECTIVE_KEYS}

    specs: list[dict[str, Any]] = [
        {"key": "LOW_DISTANCE", "label": SPECIAL_CANDIDATES["LOW_DISTANCE"]["label"], "weights": None,
         "basis": SPECIAL_CANDIDATES["LOW_DISTANCE"]["basis"], "path": single["distance"]},
        {"key": "LOW_RISK", "label": SPECIAL_CANDIDATES["LOW_RISK"]["label"], "weights": None,
         "basis": SPECIAL_CANDIDATES["LOW_RISK"]["basis"], "path": single["risk"]},
    ]
    preset_list = [(k, v) for k, v in PRESETS.items()]
    if custom and not any(weights_equal(custom, v["weights"]) for _, v in preset_list):
        preset_list.append(("CUSTOM", {"label": "Custom weights", "weights": custom,
                                        "basis": "User-defined weighted sum of normalised objectives."}))
    for key, preset in preset_list:
        w = preset["weights"]
        if sum(1 for k in OBJECTIVE_KEYS if w[k] > 0) == 1:
            only = next(k for k in OBJECTIVE_KEYS if w[k] > 0)
            path = single[only]
        else:
            cost = sum((w[k] / 100.0) * graph.costs[k] / optimum[k] for k in OBJECTIVE_KEYS)
            path = graph.shortest(cost, src, dst)
        specs.append({"key": key, "label": preset["label"], "weights": dict(w), "basis": preset["basis"], "path": path})
    timing["candidate_generation_ms"] = round((time.perf_counter() - t) * 1000, 2)

    t = time.perf_counter()
    merged: list[dict[str, Any]] = []
    for spec in specs:
        cells = set(spec["path"])
        twin = next((m for m in merged if len(cells & m["cells"]) / max(len(cells | m["cells"]), 1) >= 0.95), None)
        if twin:
            twin["also_optimal_for"].append(spec["key"])
            continue
        merged.append({**spec, "cells": cells, "also_optimal_for": []})

    candidates: list[dict[str, Any]] = []
    for spec in merged:
        raw = graph.coordinates(spec["path"])
        raw[0], raw[-1] = (a[0], unwrap_longitude(a[1], coarse.center_longitude)), (b[0], unwrap_longitude(b[1], coarse.center_longitude))
        simple, tolerance = simplify(raw, coarse.cell_km)
        totals = graph.path_totals(spec["path"])
        normalised = {k: round(totals[k] / optimum[k], 4) for k in OBJECTIVE_KEYS}
        score_weights = spec["weights"] or custom or PRESETS["BALANCED"]["weights"]
        metrics = evaluate_polyline(simple, fine, pace_kmh=eva_pace_kmh, ascent_m_per_h=ascent_allowance_m_per_h,
                                    havens=havens, evidence=items)
        metrics["objective_score"] = round(sum(score_weights[k] / 100.0 * normalised[k] for k in OBJECTIVE_KEYS), 4)
        coords = [
            {"latitude_deg": round(lat, 6), "longitude_deg": round(lon % 360.0, 6),
             "label": "START" if i == 0 else ("DESTINATION" if i == len(simple) - 1 else f"{spec['key']} {i}")}
            for i, (lat, lon) in enumerate(simple)
        ]
        uncertainties = [
            f"Planning grid cell ~{coarse.cell_km * 1000:.0f} m (MOLA 128 ppd coarsened x{coarse.coarsen_factor}); metre-scale hazards are not resolved.",
            f"Estimated EVA time assumes {eva_pace_kmh} km/h plus {ascent_allowance_m_per_h:.0f} m/h ascent allowance; not operational data.",
        ]
        if metrics["science_opportunity_score"] is None:
            uncertainties.append("SCIENCE EVIDENCE UNAVAILABLE for this planning window.")
        else:
            uncertainties.append("Science score counts proximity to catalogued evidence, not confirmed scientific value.")
        if (metrics["data_support_score"] or 0) < 100:
            uncertainties.append("Part of the route lacks finite MOLA samples; those samples are not analysed.")
        candidates.append({
            "id": f"cand-{spec['key'].lower().replace('_', '-')}",
            "key": spec["key"],
            "name": spec["label"],
            "objective_basis": spec["basis"],
            "objective_weights": spec["weights"],
            "scoring_weights": score_weights,
            "also_optimal_for": spec["also_optimal_for"],
            "generation_method": (
                f"Deterministic Dijkstra (scipy.sparse.csgraph) on an 8-connected {coarse.shape[0]}x{coarse.shape[1]} "
                f"grid from a bounded NASA MOLA 128 ppd window; Ramer-Douglas-Peucker simplification "
                f"(tolerance {tolerance:.3f} km) to <= {MAX_ROUTE_VERTICES} vertices"
            ),
            "algorithm_version": ALGORITHM_VERSION,
            "coordinates": coords,
            "metrics": metrics,
            "normalised_objectives": normalised,
            "planning_path_cells": len(spec["path"]),
            "uncertainties": uncertainties,
            "provenance": {
                "terrain": f"{fine.source} ({fine.dataset})",
                "evidence": sorted({item.source for item in items}) or ["none ingested"],
                "generation": "DERIVED / COMPUTED by NeuroNexus deterministic engine; no LLM involvement in geometry",
                "eva_pace_kmh": eva_pace_kmh,
                "ascent_allowance_m_per_h": ascent_allowance_m_per_h,
            },
        })

    vectors = [
        [c["metrics"]["estimated_eva_hours"], c["metrics"]["terrain_burden_score"], c["metrics"]["terrain_risk_proxy"],
         c["metrics"]["operational_burden_score"],
         None if c["metrics"]["science_opportunity_score"] is None else -c["metrics"]["science_opportunity_score"]]
        for c in candidates
    ]
    flags, used = pareto_flags(vectors)
    names = ["estimated_eva_hours", "terrain_burden_score", "terrain_risk_proxy", "operational_burden_score", "science_opportunity_score (maximised)"]
    for candidate, flag in zip(candidates, flags):
        candidate["pareto_non_dominated"] = bool(flag)
        candidate["pareto_label"] = "PARETO / NON-DOMINATED" if flag else "DOMINATED IN THIS SET"
    timing["scoring_ms"] = round((time.perf_counter() - t) * 1000, 2)
    timing["total_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    for candidate in candidates:
        candidate["metrics"]["route_generation_time_ms"] = timing["total_ms"]

    return {
        "engine": "NeuroNexus deterministic multi-objective route engine",
        "algorithm_version": ALGORITHM_VERSION,
        "status": "ok",
        "start": {"latitude_deg": a[0], "longitude_deg": a[1]},
        "destination": {"latitude_deg": b[0], "longitude_deg": b[1]},
        "requested_weights": custom,
        "window": {**window, "rows": fine.shape[0], "cols": fine.shape[1],
                   "planning_rows": coarse.shape[0], "planning_cols": coarse.shape[1],
                   "coarsen_factor": coarse.coarsen_factor, "planning_cell_km": round(coarse.cell_km, 4),
                   "terrain_source": fine.source, "dataset": fine.dataset},
        "evidence_status": evidence_status,
        "evidence_items": [item.to_dict() for item in items][:300],
        "candidates": candidates,
        "pareto": {"objectives_compared": [names[i] for i in used], "non_dominated_ids": [c["id"] for c in candidates if c["pareto_non_dominated"]]},
        "methodology": {**METHODOLOGY, "scalarisation": SCALARISATION, "objective_optima": {k: round(v, 5) for k, v in optimum.items()}},
        "timing_ms": timing,
        "safety_notice": "Candidates are research outputs. None is labelled safe or certified.",
    }


def _evaluate_single_window(
    coordinates: list[dict[str, Any]],
    *,
    eva_pace_kmh: float = DEFAULT_EVA_PACE_KMH,
    ascent_allowance_m_per_h: float = DEFAULT_ASCENT_M_PER_H,
    safe_havens: list[dict[str, Any]] | None = None,
    include_science: bool = True,
    grid: TerrainGrid | None = None,
    evidence: list[EvidenceItem] | None = None,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    points = [_point(c) for c in coordinates]
    window = planning_window(points)
    status = "ok"
    error = None
    try:
        fine = grid if grid is not None else load_grid(window)
    except (FileNotFoundError, ValueError) as exc:
        fine, status, error = None, "terrain_unavailable", str(exc)
    items, evidence_status = _collect(window, include_science, evidence)
    metrics = evaluate_polyline(points, fine, pace_kmh=eva_pace_kmh, ascent_m_per_h=ascent_allowance_m_per_h,
                                havens=list(safe_havens or []), evidence=items)
    metrics["route_generation_time_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return {"status": status, "error": error, "algorithm_version": ALGORITHM_VERSION, "window": window,
            "metrics": metrics, "evidence_status": evidence_status,
            "methodology": METHODOLOGY}


# ---------------------------------------------------------------- long traverses
#
# START -> leg -> anchor -> leg -> anchor -> ... -> DESTINATION
#
# Anchors are placed on the great circle between start and destination
# (spherical interpolation on the Mars sphere). Every leg is planned by the
# SAME bounded-window MOLA planner used for short routes, so terrain-aware
# routing, candidate families and metrics are identical in kind. Leg results
# are joined per candidate family and their metrics aggregated exactly
# (sums for distance/EVA/gain/loss, distance-weighted means, maxima for maxima).


def _window_too_large(points: Sequence[tuple[float, float]]) -> bool:
    try:
        planning_window(points)
        return False
    except ValueError:
        return True


def great_circle_points(a: tuple[float, float], b: tuple[float, float], parts: int) -> list[tuple[float, float]]:
    """parts+1 points from a to b on the great circle (spherical linear interpolation)."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    v1 = np.array([math.cos(lat1) * math.cos(lon1), math.cos(lat1) * math.sin(lon1), math.sin(lat1)])
    v2 = np.array([math.cos(lat2) * math.cos(lon2), math.cos(lat2) * math.sin(lon2), math.sin(lat2)])
    omega = math.acos(max(-1.0, min(1.0, float(np.dot(v1, v2)))))
    out: list[tuple[float, float]] = []
    for i in range(parts + 1):
        t = i / parts
        if omega < 1e-12:
            v = v1
        else:
            v = (math.sin((1 - t) * omega) * v1 + math.sin(t * omega) * v2) / math.sin(omega)
        lat = math.degrees(math.atan2(v[2], math.hypot(v[0], v[1])))
        lon = math.degrees(math.atan2(v[1], v[0])) % 360.0
        out.append((lat, lon))
    out[0], out[-1] = a, b  # exact endpoints
    return out


def segment_anchors(a: tuple[float, float], b: tuple[float, float]) -> list[tuple[float, float]]:
    """Great-circle anchors so that every leg's planning window fits MAX_WINDOW_KM."""
    distance = float(haversine_km(a[0], a[1], b[0], b[1]))
    parts = max(1, math.ceil(distance / SEGMENT_TARGET_KM))
    while parts <= MAX_SEGMENTS:
        anchors = great_circle_points(a, b, parts)
        if not any(_window_too_large([anchors[i], anchors[i + 1]]) for i in range(parts)):
            return anchors
        parts += 1
    raise ValueError(
        f"Traverse of {distance:.0f} km would need more than {MAX_SEGMENTS} local MOLA segments; "
        "choose a closer destination or split the traverse into shorter routes."
    )


def _weighted_mean(values: list[float | None], weights: list[float]) -> float | None:
    pairs = [(v, w) for v, w in zip(values, weights) if v is not None and w > 0]
    total = sum(w for _, w in pairs)
    return None if not pairs or total <= 0 else sum(v * w for v, w in pairs) / total


def _max_or_none(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return max(present) if present else None


def _min_or_none(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return min(present) if present else None


def _sum_or_none(values: list[float | None]) -> float | None:
    return None if any(v is None for v in values) else sum(values)


def aggregate_leg_metrics(legs: list[dict[str, Any]], coordinates: list[tuple[float, float]], *,
                          pace_kmh: float, ascent_m_per_h: float) -> dict[str, Any]:
    """Combine per-leg metrics into whole-route metrics with the same schema."""
    d = [float(m["distance_km"] or 0.0) for m in legs]
    distance = sum(d)
    gain = _sum_or_none([m.get("elevation_gain_m") for m in legs])
    loss = _sum_or_none([m.get("elevation_loss_m") for m in legs])
    summary = {
        "mean_slope_deg": _weighted_mean([m.get("mean_slope_deg") for m in legs], d),
        "max_slope_deg": _max_or_none([m.get("max_slope_deg") for m in legs]),
        # a leg-wise maximum is a conservative (upper-bound) p90 for the whole route
        "p90_slope_deg": _max_or_none([m.get("p90_slope_deg") for m in legs]),
        "mean_roughness_m": _weighted_mean([m.get("mean_roughness_m") for m in legs], d),
        "max_roughness_m": _max_or_none([m.get("max_roughness_m") for m in legs]),
        "elevation_min_m": _min_or_none([m.get("elevation_min_m") for m in legs]),
        "elevation_max_m": _max_or_none([m.get("elevation_max_m") for m in legs]),
        "elevation_gain_m": gain,
        "elevation_loss_m": loss,
        "terrain_burden_score": _weighted_mean([m.get("terrain_burden_score") for m in legs], d),
    }
    risk, components = terrain_risk_proxy(
        max_slope_deg=summary["max_slope_deg"], p90_slope_deg=summary["p90_slope_deg"],
        max_roughness_m=summary["max_roughness_m"], elevation_gain_m=gain, elevation_loss_m=loss,
        distance_km=distance,
    )
    engaged: dict[str, dict[str, Any]] = {}
    available = 0
    science_known = all(m.get("science_opportunity_score") is not None for m in legs)
    for m in legs:
        available += int(m.get("science_evidence_available") or 0)
        for item in m.get("science_evidence") or []:
            best = engaged.get(item["id"])
            if best is None or item["min_distance_km"] < best["min_distance_km"]:
                engaged[item["id"]] = item
    science_score = round(100.0 * len(engaged) / available, 2) if science_known and available else None
    rounded = {k: (None if v is None else round(float(v), 3)) for k, v in summary.items()}
    return {
        "distance_km": round(distance, 4),
        "displacement_km": round(float(haversine_km(coordinates[0][0], coordinates[0][1],
                                                    coordinates[-1][0], coordinates[-1][1])), 4),
        "estimated_eva_hours": estimate_eva_hours(distance, gain, pace_kmh, ascent_m_per_h),
        "eva_pace_kmh": pace_kmh,
        "ascent_allowance_m_per_h": ascent_m_per_h,
        **rounded,
        "terrain_risk_proxy": risk,
        "terrain_risk_components": components,
        "operational_burden_score": (lambda v: None if v is None else round(v, 3))(
            _weighted_mean([m.get("operational_burden_score") for m in legs], d)),
        "max_distance_from_safe_haven_km": _max_or_none([m.get("max_distance_from_safe_haven_km") for m in legs]),
        "operational_reference": legs[0].get("operational_reference"),
        "science_opportunity_score": science_score,
        "science_evidence_count": len(engaged) if science_score is not None else None,
        "science_evidence_available": available,
        "science_evidence": sorted(engaged.values(), key=lambda item: item["min_distance_km"]),
        "data_support_score": (lambda v: None if v is None else round(v, 2))(
            _weighted_mean([m.get("data_support_score") for m in legs], d)),
        "sample_count": sum(int(m.get("sample_count") or 0) for m in legs),
        "sample_spacing_km": _max_or_none([m.get("sample_spacing_km") for m in legs]),
        "segment_count": len(legs),
        "segment_distances_km": [round(x, 3) for x in d],
    }


def _simplify_keeping(coords: list[tuple[float, float]], keep: set[int], limit: int) -> list[tuple[float, float]]:
    """RDP down to `limit` vertices while keeping anchor indices when the budget allows."""
    keep = {i for i in keep if 0 < i < len(coords) - 1}
    if len(keep) + 2 > limit:
        keep = set()
    if len(coords) <= limit:
        return coords
    xy = _local_xy(coords)
    lo, hi = 1e-6, 1e6
    best = [0, len(coords) - 1]
    for _ in range(60):
        eps = math.sqrt(lo * hi)
        idx = sorted(set(_rdp(xy, eps)) | keep | {0, len(coords) - 1})
        if len(idx) <= limit:
            best, hi = idx, eps
        else:
            lo = eps
    return [coords[i] for i in best]


def _family_identity(key: str, base: dict[str, Any], custom: dict[str, int] | None = None) -> dict[str, Any]:
    """Name a joined candidate by its own objective family, not by leg 1's merged twin."""
    if key in SPECIAL_CANDIDATES:
        label, basis, weights = SPECIAL_CANDIDATES[key]["label"], SPECIAL_CANDIDATES[key]["basis"], None
    elif key in PRESETS:
        label, basis, weights = PRESETS[key]["label"], PRESETS[key]["basis"], dict(PRESETS[key]["weights"])
    elif key == "CUSTOM" and custom:
        label, basis, weights = "Custom weights", "User-defined weighted sum of normalised objectives.", dict(custom)
    else:
        label, basis, weights = base["name"], base["objective_basis"], base["objective_weights"]
    return {"id": f"cand-{key.lower().replace('_', '-')}", "key": key, "name": label,
            "objective_basis": basis, "objective_weights": weights}


def _candidate_for(result: dict[str, Any], key: str) -> dict[str, Any] | None:
    for candidate in result["candidates"]:
        if candidate["key"] == key or key in candidate.get("also_optimal_for", []):
            return candidate
    return None


def _plan_segmented(a: tuple[float, float], b: tuple[float, float], anchors: list[tuple[float, float]], **kwargs: Any) -> dict[str, Any]:
    t0 = time.perf_counter()
    legs = []
    for i in range(len(anchors) - 1):
        legs.append(_plan_single_window(
            {"latitude_deg": anchors[i][0], "longitude_deg": anchors[i][1]},
            {"latitude_deg": anchors[i + 1][0], "longitude_deg": anchors[i + 1][1]},
            **kwargs,
        ))
    first = legs[0]
    pace = kwargs.get("eva_pace_kmh", DEFAULT_EVA_PACE_KMH)
    ascent = kwargs.get("ascent_allowance_m_per_h", DEFAULT_ASCENT_M_PER_H)
    custom = first.get("requested_weights")

    keys: list[str] = []
    for candidate in first["candidates"]:
        for key in [candidate["key"], *candidate.get("also_optimal_for", [])]:
            if key not in keys:
                keys.append(key)

    families: list[dict[str, Any]] = []
    for key in keys:
        parts = [_candidate_for(leg, key) for leg in legs]
        if any(part is None for part in parts):
            continue
        full: list[tuple[float, float]] = []
        anchor_index: set[int] = set()
        for n, part in enumerate(parts):
            pts = [(c["latitude_deg"], c["longitude_deg"]) for c in part["coordinates"]]
            if n:
                anchor_index.add(len(full) - 1)
                pts = pts[1:]
            full.extend(pts)
        full[0], full[-1] = a, b
        families.append({"key": key, "parts": parts, "path": full, "anchor_index": anchor_index})

    # Merge families whose joined paths are identical, as the single-window planner does.
    merged: list[dict[str, Any]] = []
    for fam in families:
        twin = next((m for m in merged if m["path"] == fam["path"]), None)
        if twin:
            twin["also_optimal_for"].append(fam["key"])
        else:
            merged.append({**fam, "also_optimal_for": []})

    candidates = []
    for fam in merged:
        base = fam["parts"][0]
        identity = _family_identity(fam["key"], base, custom)
        metrics = aggregate_leg_metrics([p["metrics"] for p in fam["parts"]], fam["path"], pace_kmh=pace, ascent_m_per_h=ascent)
        score_weights = identity["objective_weights"] or base["scoring_weights"]
        normalised = {k: round(_weighted_mean([p["normalised_objectives"][k] for p in fam["parts"]],
                                              [p["metrics"]["distance_km"] or 0.0 for p in fam["parts"]]) or 0.0, 4)
                      for k in OBJECTIVE_KEYS}
        metrics["objective_score"] = round(sum(score_weights[k] / 100.0 * normalised[k] for k in OBJECTIVE_KEYS), 4)
        editor = _simplify_keeping(fam["path"], fam["anchor_index"], MAX_ROUTE_VERTICES)
        coords = [
            {"latitude_deg": round(lat, 6), "longitude_deg": round(lon % 360.0, 6),
             "label": "START" if i == 0 else ("DESTINATION" if i == len(editor) - 1 else f"{fam['key']} {i}")}
            for i, (lat, lon) in enumerate(editor)
        ]
        path = [{"latitude_deg": round(lat, 6), "longitude_deg": round(lon % 360.0, 6)} for lat, lon in fam["path"]]
        uncertainties = [
            f"Long traverse planned in {len(legs)} local MOLA segments joined at great-circle anchors; "
            "the route is optimal within each segment, not guaranteed globally optimal.",
            *base["uncertainties"],
        ]
        if len(path) > len(coords):
            uncertainties.append(
                f"Route editor holds {len(coords)} of {len(path)} terrain-aware vertices; metrics are computed on the full path."
            )
        candidates.append({
            **{k: base[k] for k in ("algorithm_version", "provenance")},
            **identity,
            "scoring_weights": score_weights,
            "also_optimal_for": fam["also_optimal_for"],
            "generation_method": base["generation_method"] + f"; long traverse: {len(legs)} segments joined at great-circle anchors",
            "coordinates": coords,
            "path_coordinates": path,
            "metrics": metrics,
            "normalised_objectives": normalised,
            "planning_path_cells": sum(p["planning_path_cells"] for p in fam["parts"]),
            "uncertainties": uncertainties,
            "segments": [{"index": n + 1, "distance_km": p["metrics"]["distance_km"],
                          "estimated_eva_hours": p["metrics"]["estimated_eva_hours"]} for n, p in enumerate(fam["parts"])],
        })

    vectors = [
        [c["metrics"]["estimated_eva_hours"], c["metrics"]["terrain_burden_score"], c["metrics"]["terrain_risk_proxy"],
         c["metrics"]["operational_burden_score"],
         None if c["metrics"]["science_opportunity_score"] is None else -c["metrics"]["science_opportunity_score"]]
        for c in candidates
    ]
    flags, used = pareto_flags(vectors)
    names = ["estimated_eva_hours", "terrain_burden_score", "terrain_risk_proxy", "operational_burden_score", "science_opportunity_score (maximised)"]
    for candidate, flag in zip(candidates, flags):
        candidate["pareto_non_dominated"] = bool(flag)
        candidate["pareto_label"] = "PARETO / NON-DOMINATED" if flag else "DOMINATED IN THIS SET"

    total_ms = round((time.perf_counter() - t0) * 1000, 2)
    for candidate in candidates:
        candidate["metrics"]["route_generation_time_ms"] = total_ms

    timing = {key: round(sum(leg["timing_ms"].get(key, 0.0) for leg in legs), 2)
              for key in ("terrain_sampling_ms", "evidence_ms", "candidate_generation_ms", "scoring_ms")}
    timing["total_ms"] = total_ms

    evidence_items: dict[str, dict[str, Any]] = {}
    for leg in legs:
        for item in leg["evidence_items"]:
            evidence_items.setdefault(item.get("id"), item)

    message = f"Long traverse detected — planning terrain-aware route in {len(legs)} local MOLA segments."
    return {
        **{k: first[k] for k in ("engine", "algorithm_version", "requested_weights", "methodology", "safety_notice")},
        "status": "ok",
        "start": {"latitude_deg": a[0], "longitude_deg": a[1]},
        "destination": {"latitude_deg": b[0], "longitude_deg": b[1]},
        "window": {
            **first["window"],
            "width_km": round(sum(leg["window"]["width_km"] for leg in legs), 3),
            "height_km": round(max(leg["window"]["height_km"] for leg in legs), 3),
            "segment_count": len(legs),
        },
        "segmentation": {
            "segmented": True,
            "segment_count": len(legs),
            "segment_target_km": SEGMENT_TARGET_KM,
            "max_window_km": MAX_WINDOW_KM,
            "anchors": [{"latitude_deg": round(lat, 6), "longitude_deg": round(lon % 360.0, 6)} for lat, lon in anchors],
            "method": "Great-circle anchors on the Mars sphere; each segment planned on its own bounded MOLA 128 ppd window.",
            "message": message,
        },
        "message": message,
        "evidence_status": {f"segment_{n + 1}": leg["evidence_status"] for n, leg in enumerate(legs)},
        "evidence_items": list(evidence_items.values())[:300],
        "candidates": candidates,
        "pareto": {"objectives_compared": [names[i] for i in used], "non_dominated_ids": [c["id"] for c in candidates if c["pareto_non_dominated"]]},
        "timing_ms": timing,
    }


def plan_route_candidates(
    start: dict[str, Any],
    destination: dict[str, Any],
    *,
    grid: TerrainGrid | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Plan candidates; long traverses are split into bounded local MOLA segments."""
    a, b = _point(start), _point(destination)
    if not _window_too_large([a, b]):
        result = _plan_single_window(start, destination, grid=grid, **kwargs)
        result["segmentation"] = {"segmented": False, "segment_count": 1, "max_window_km": MAX_WINDOW_KM}
        return result
    if grid is not None:
        # An injected grid covers exactly one window, so it cannot serve other segments.
        planning_window([a, b])  # raises the bounded-window ValueError
    return _plan_segmented(a, b, segment_anchors(a, b), **kwargs)


def evaluate_route(
    coordinates: list[dict[str, Any]],
    *,
    grid: TerrainGrid | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Evaluate a polyline; long polylines are evaluated in bounded local MOLA chunks."""
    points = [_point(c) for c in coordinates]
    if grid is not None or not _window_too_large(points):
        return _evaluate_single_window(coordinates, grid=grid, **kwargs)

    t0 = time.perf_counter()
    # Densify every edge onto the great circle so no chunk contains an over-long edge.
    dense: list[tuple[float, float]] = [points[0]]
    for p, q in zip(points, points[1:]):
        edge = float(haversine_km(p[0], p[1], q[0], q[1]))
        parts = max(1, math.ceil(edge / (SEGMENT_TARGET_KM / 2)))
        dense.extend(great_circle_points(p, q, parts)[1:])
    chunks: list[list[tuple[float, float]]] = []
    current = [dense[0]]
    for point in dense[1:]:
        if len(current) >= 2 and _window_too_large(current + [point]):
            chunks.append(current)
            current = [current[-1], point]
        else:
            current.append(point)
    chunks.append(current)

    results = [_evaluate_single_window([{"latitude_deg": lat, "longitude_deg": lon} for lat, lon in chunk], **kwargs)
               for chunk in chunks]
    status = "ok" if all(r["status"] == "ok" for r in results) else "terrain_unavailable"
    errors = [r["error"] for r in results if r.get("error")]
    metrics = aggregate_leg_metrics([r["metrics"] for r in results], points,
                                    pace_kmh=kwargs.get("eva_pace_kmh", DEFAULT_EVA_PACE_KMH),
                                    ascent_m_per_h=kwargs.get("ascent_allowance_m_per_h", DEFAULT_ASCENT_M_PER_H))
    metrics["route_generation_time_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return {
        "status": status,
        "error": "; ".join(dict.fromkeys(errors)) or None,
        "algorithm_version": ALGORITHM_VERSION,
        "window": {**results[0]["window"], "segment_count": len(chunks)},
        "segmentation": {"segmented": True, "segment_count": len(chunks),
                         "message": f"Long route evaluated in {len(chunks)} local MOLA segments."},
        "metrics": metrics,
        "evidence_status": {f"segment_{n + 1}": r["evidence_status"] for n, r in enumerate(results)},
        "methodology": results[0]["methodology"],
    }
