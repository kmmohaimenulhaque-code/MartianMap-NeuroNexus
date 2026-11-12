const STAT_LABELS = { min: "Minimum recorded", max: "Maximum recorded", mean: "Mean recorded" };

function finiteNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatThermalNumber(value, unit = "", digits = 1) {
  const number = finiteNumber(value);
  return number === null ? "—" : `${number.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function hasStats(stats) {
  return Object.keys(STAT_LABELS).some((key) =>
    [stats?.[`${key}_k`], stats?.[`${key}_c`]].some((value) => finiteNumber(value) !== null),
  );
}

function temperatureStats(stats) {
  return Object.entries(STAT_LABELS).map(([key, label]) => ({
    key,
    label,
    value: formatThermalNumber(stats?.[`${key}_k`], "K"),
    detail: formatThermalNumber(stats?.[`${key}_c`], "°C"),
  }));
}

export function buildThermalPanel(thermal) {
  const nearest = thermal?.observations?.[0];
  const summary = thermal?.historical_summary;
  const coverage = summary?.coverage;
  const sampleCount = finiteNumber(coverage?.sample_count);
  const validCount = finiteNumber(coverage?.valid_sample_count);
  const hasHistorical = (validCount ?? sampleCount ?? 0) > 0 && hasStats(summary);
  const radius = finiteNumber(coverage?.search_radius_km);
  const distance = finiteNumber(nearest?.spatial_distance_km);
  const outsideRadius = radius !== null && distance !== null && distance > radius;
  const nearestK = formatThermalNumber(nearest?.brightness_temperature_k, "K");
  const nearestC = formatThermalNumber(nearest?.brightness_temperature_c, "°C");
  const hasNearest = nearestK !== "—" || nearestC !== "—";
  const nearestContext = outsideRadius
    ? "Outside the historical search radius; reference only, not matching radius data"
    : !summary
      ? "Legacy nearest THEMIS reference; radius aggregate unavailable"
      : !hasHistorical
        ? "Separate nearest THEMIS reference; not matching usable historical radius data"
        : "Nearest historical THEMIS observation; separate from radius aggregate";
  const conditions = hasHistorical
    ? ["day", "night"].flatMap((condition) => {
        const stats = summary.day_night?.[condition];
        if (!(finiteNumber(stats?.sample_count) > 0) || !hasStats(stats)) return [];
        return [{
          key: condition,
          label: `${condition === "day" ? "Day" : "Night"} observations (${formatThermalNumber(stats.sample_count, "", 0)})`,
          stats: temperatureStats(stats),
        }];
      })
    : [];
  const suppliedNote = typeof summary?.condition_note === "string" ? summary.condition_note.trim() : "";
  const fraction = finiteNumber(coverage?.seasonal_coverage_fraction);
  const binsTotal = finiteNumber(coverage?.seasonal_bins_total);
  const evidence = nearest?.evidence;
  const defaultConditionNote = conditions.length === 2
    ? "Overall observations may combine source-classified day and night conditions."
    : conditions.length === 1
      ? `Only source-classified ${conditions[0].key} observations were available; no counterpart classification was present.`
      : "Day/night classification unavailable. Overall observations may combine differing seasons and local times.";

  return {
    hasHistorical,
    unavailableDetail: summary
      ? "No usable historical temperature observations within the search radius."
      : "Historical radius aggregate unavailable in this response.",
    nearest: {
      label: outsideRadius ? "Nearest brightness temperature · outside-radius reference" : "Nearest historical brightness temperature",
      value: nearestK !== "—" ? nearestK : nearestC,
      detail: hasNearest
        ? [nearestK !== "—" && nearestC !== "—" ? nearestC : null, nearestContext, distance !== null ? `${formatThermalNumber(distance, "km")} away` : null].filter(Boolean).join(" · ")
        : "Nearest temperature unavailable",
    },
    stats: temperatureStats(hasHistorical ? summary : null),
    evidence: {
      label: evidence?.label ?? "—",
      score: formatThermalNumber(evidence?.score),
      observationCount: formatThermalNumber(evidence?.observation_count, "", 0),
      years: Array.isArray(evidence?.years) ? evidence.years.join(", ") || "—" : evidence?.years ?? "—",
    },
    coverage: {
      sampleCount: formatThermalNumber(sampleCount, "", 0),
      validSampleCount: formatThermalNumber(validCount, "", 0),
      searchRadius: formatThermalNumber(radius, "km", 0),
      years: coverage?.observation_years?.length ? coverage.observation_years.join(", ") : "—",
      seasonalCoverage: hasHistorical && fraction !== null ? `${(fraction * 100).toFixed(1)}%` : "—",
      seasonalBins: binsTotal > 0 ? `${formatThermalNumber(coverage?.seasonal_bins, "", 0)}/${binsTotal} Ls bins` : undefined,
    },
    conditions,
     conditionNote: suppliedNote || defaultConditionNote,
  };
}
