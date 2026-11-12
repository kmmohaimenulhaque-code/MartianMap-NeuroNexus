// frontend/src/utils/routeIntelligence.js

const MARS_RADIUS_KM = 3389.5;
const DEFAULT_EVA_PACE_KMH = 2.5;

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);

    if (number !== null) {
      return number;
    }
  }

  return null;
}

function normalizeLongitude(lon) {
  const value = Number(lon);

  if (!Number.isFinite(value)) {
    return null;
  }

  let normalized = value % 360;

  if (normalized < 0) {
    normalized += 360;
  }

  return normalized;
}

export function normalizePoint(point) {
  if (!point) {
    return null;
  }

  const lat = firstNumber(
    point.lat,
    point.latitude,
    point.latitude_deg
  );

  const lon = firstNumber(
    point.lng,
    point.lon,
    point.longitude,
    point.longitude_deg
  );

  if (lat === null || lon === null) {
    return null;
  }

  return {
    lat,
    lng: normalizeLongitude(lon),
  };
}

export function haversineDistanceKm(a, b) {
  const pointA = normalizePoint(a);
  const pointB = normalizePoint(b);

  if (!pointA || !pointB) {
    return 0;
  }

  const lat1 = (pointA.lat * Math.PI) / 180;
  const lat2 = (pointB.lat * Math.PI) / 180;

  const deltaLat =
    ((pointB.lat - pointA.lat) * Math.PI) / 180;

  const deltaLon =
    ((pointB.lng - pointA.lng) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLon *
      sinLon;

  const arc =
    2 * Math.atan2(
      Math.sqrt(h),
      Math.sqrt(Math.max(0, 1 - h))
    );

  return MARS_RADIUS_KM * arc;
}

export function routeDistanceKm(points = []) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += haversineDistanceKm(
      points[index - 1],
      points[index]
    );
  }

  return total;
}

function walkObject(value, visitor, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) {
    return null;
  }

  const result = visitor(value);

  if (result !== undefined && result !== null) {
    return result;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = walkObject(
        item,
        visitor,
        depth + 1
      );

      if (nested !== null && nested !== undefined) {
        return nested;
      }
    }

    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const found = walkObject(
      nestedValue,
      visitor,
      depth + 1
    );

    if (found !== null && found !== undefined) {
      return found;
    }

    void key;
  }

  return null;
}

function findNumericByAliases(value, aliases = []) {
  const wanted = aliases.map((alias) =>
    String(alias)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
  );

  return walkObject(value, (object) => {
    for (const [key, objectValue] of Object.entries(object)) {
      const normalizedKey = key
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      if (!wanted.includes(normalizedKey)) {
        continue;
      }

      const number = toNumber(objectValue);

      if (number !== null) {
        return number;
      }
    }

    return null;
  });
}

function findTextByAliases(value, aliases = []) {
  const wanted = aliases.map((alias) =>
    String(alias)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
  );

  return walkObject(value, (object) => {
    for (const [key, objectValue] of Object.entries(object)) {
      const normalizedKey = key
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      if (!wanted.includes(normalizedKey)) {
        continue;
      }

      if (
        typeof objectValue === "string" &&
        objectValue.trim()
      ) {
        return objectValue.trim();
      }
    }

    return null;
  });
}

export function extractRouteMetrics(
  routePlan,
  routePoints = [],
  evaPaceKmh = DEFAULT_EVA_PACE_KMH
) {
  const distanceFromPlan = findNumericByAliases(
    routePlan,
    [
      "distance_km",
      "total_distance_km",
      "route_distance_km",
      "total_km",
      "distance",
    ]
  );

  const distanceKm =
    distanceFromPlan !== null
      ? distanceFromPlan
      : routeDistanceKm(routePoints);

  const maxSlopeDeg = findNumericByAliases(
    routePlan,
    [
      "max_slope_deg",
      "maximum_slope_deg",
      "max_slope",
      "maximum_slope",
    ]
  );

  const meanSlopeDeg = findNumericByAliases(
    routePlan,
    [
      "mean_slope_deg",
      "average_slope_deg",
      "mean_slope",
      "average_slope",
    ]
  );

  const maxRoughness = findNumericByAliases(
    routePlan,
    [
      "max_roughness",
      "maximum_roughness",
      "roughness_max",
    ]
  );

  const meanRoughness = findNumericByAliases(
    routePlan,
    [
      "mean_roughness",
      "average_roughness",
      "roughness_mean",
    ]
  );

  const imageryCoveragePct =
    findNumericByAliases(
      routePlan,
      [
        "imagery_coverage_pct",
        "image_coverage_pct",
        "imagery_coverage_percent",
        "image_coverage_percent",
      ]
    );

  const thermalCoveragePct =
    findNumericByAliases(
      routePlan,
      [
        "thermal_coverage_pct",
        "thermal_coverage_percent",
        "thermal_coverage",
      ]
    );

  const imageryStatus = findTextByAliases(
    routePlan,
    [
      "imagery_status",
      "image_coverage_status",
      "imagery_coverage_status",
    ]
  );

  const thermalStatus = findTextByAliases(
    routePlan,
    [
      "thermal_status",
      "thermal_coverage_status",
    ]
  );

  const safePace =
    Number.isFinite(Number(evaPaceKmh)) &&
    Number(evaPaceKmh) > 0
      ? Number(evaPaceKmh)
      : DEFAULT_EVA_PACE_KMH;

  const estimatedEvaHours =
    distanceKm !== null
      ? distanceKm / safePace
      : null;

  return {
    distanceKm,
    maxSlopeDeg,
    meanSlopeDeg,
    maxRoughness,
    meanRoughness,
    imageryCoveragePct,
    imageryStatus,
    thermalCoveragePct,
    thermalStatus,
    evaPaceKmh: safePace,
    estimatedEvaHours,
  };
}

export function buildRouteAssessment(
  routePlan,
  routePoints = [],
  options = {}
) {
  const evaPaceKmh =
    options.evaPaceKmh ??
    DEFAULT_EVA_PACE_KMH;

  const metrics = extractRouteMetrics(
    routePlan,
    routePoints,
    evaPaceKmh
  );

  const pros = [];
  const cons = [];

  if (metrics.distanceKm !== null) {
    pros.push({
      id: "distance",
      text: `Distance calculated: ${metrics.distanceKm.toFixed(
        2
      )} km.`,
      evidence: "COMPUTED",
    });
  }

  if (metrics.maxSlopeDeg !== null) {
    pros.push({
      id: "slope",
      text: `Maximum slope is available: ${metrics.maxSlopeDeg.toFixed(
        2
      )}°.`,
      evidence: "DERIVED",
    });
  } else {
    cons.push({
      id: "slope-unavailable",
      text: "Maximum slope is unavailable for this route.",
      evidence: "UNAVAILABLE",
    });
  }

  if (metrics.imageryCoveragePct !== null) {
    pros.push({
      id: "imagery",
      text: `Imagery coverage reported at ${metrics.imageryCoveragePct.toFixed(
        1
      )}%.`,
      evidence: "OBSERVED / COVERAGE",
    });
  } else if (metrics.imageryStatus) {
    pros.push({
      id: "imagery-status",
      text: `Imagery: ${metrics.imageryStatus}.`,
      evidence: "COVERAGE",
    });
  } else {
    cons.push({
      id: "imagery-unavailable",
      text: "Imagery coverage could not be established from the supplied route data.",
      evidence: "UNAVAILABLE",
    });
  }

  if (metrics.maxRoughness !== null) {
    cons.push({
      id: "roughness",
      text: `Maximum roughness reported: ${metrics.maxRoughness.toFixed(
        2
      )}.`,
      evidence: "DERIVED",
    });
  } else if (metrics.meanRoughness !== null) {
    cons.push({
      id: "roughness-mean",
      text: `Mean roughness reported: ${metrics.meanRoughness.toFixed(
        2
      )}.`,
      evidence: "DERIVED",
    });
  } else {
    cons.push({
      id: "roughness-unavailable",
      text: "Roughness is unavailable for this route.",
      evidence: "UNAVAILABLE",
    });
  }

  if (metrics.thermalCoveragePct !== null) {
    cons.push({
      id: "thermal",
      text: `Thermal data coverage: ${metrics.thermalCoveragePct.toFixed(
        1
      )}%.`,
      evidence: "COVERAGE",
    });
  } else if (metrics.thermalStatus) {
    cons.push({
      id: "thermal-status",
      text: `Thermal data: ${metrics.thermalStatus}.`,
      evidence: "COVERAGE",
    });
  } else {
    cons.push({
      id: "thermal-unavailable",
      text: "Thermal coverage is unavailable for this route.",
      evidence: "UNAVAILABLE",
    });
  }

  if (metrics.estimatedEvaHours !== null) {
    cons.push({
      id: "eva",
      text: `Estimated EVA time: ${metrics.estimatedEvaHours.toFixed(
        1
      )} h at ${metrics.evaPaceKmh.toFixed(
        1
      )} km/h.`,
      evidence: "SIMULATED",
    });
  }

  return {
    metrics,
    pros,
    cons,
    methodology: {
      distance:
        "Haversine waypoint geometry or backend route-plan distance.",
      terrain:
        "Uses supplied MOLA-derived route metrics where present.",
      imagery:
        "Uses only imagery coverage supplied by the route data.",
      thermal:
        "Uses only thermal coverage/status supplied by the route data.",
      eva:
        "Illustrative planning estimate; pace is configurable and is not a NASA operational standard.",
    },
  };
}

export function createRouteSnapshot({
  id,
  name,
  routePoints = [],
  routePlan = null,
  evaPaceKmh = DEFAULT_EVA_PACE_KMH,
}) {
  const cleanPoints = routePoints
    .map(normalizePoint)
    .filter(Boolean);

  const analysis = buildRouteAssessment(
    routePlan,
    cleanPoints,
    { evaPaceKmh }
  );

  return {
    id:
      id ||
      `route-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    name:
      name ||
      `ROUTE ${new Date().toLocaleTimeString()}`,
    createdAt: new Date().toISOString(),
    points: cleanPoints,
    metrics: analysis.metrics,
    pros: analysis.pros,
    cons: analysis.cons,
    methodology: analysis.methodology,
  };
}

export function formatMetric(
  value,
  digits = 2,
  suffix = ""
) {
  const number = toNumber(value);

  if (number === null) {
    return "UNAVAILABLE";
  }

  return `${number.toFixed(digits)}${suffix}`;
}

export {
  DEFAULT_EVA_PACE_KMH,
  MARS_RADIUS_KM,
};
