/*
 * Universal exports. Every file carries the same provenance block: plan_id (when a plan exists),
 * active_sol, season_ls, data_versions, retrieved_at and exported_at. Builders are pure (tested);
 * downloadText() is the only browser-facing piece.
 */

export const EXPORT_SCHEMA = "neuronexus.export.v4";
export const BRIEF_BUNDLE_SCHEMA = "neuronexus.eva-brief.v4";

export function provenance({ plan = null, sol = null, seasonLs = null, retrievedAt = null, dataVersions = null, extra = {} } = {}, now = new Date()) {
  return {
    schema: EXPORT_SCHEMA,
    plan_id: plan?.plan_id ?? null,
    active_sol: sol,
    active_sol_basis: "NASA Ames MGCM MY34 scenario sol (console activeSol)",
    season_ls: Number.isFinite(seasonLs) ? Math.round(seasonLs * 100) / 100 : null,
    data_versions: dataVersions ?? plan?.data_versions ?? [],
    engine_version: plan?.engine_version ?? null,
    config_hash: plan?.config_hash ?? null,
    source_ids: plan?.source_ids ?? [],
    retrieved_at: retrievedAt,
    exported_at: now.toISOString(),
    ...extra,
  };
}

/* Route LineString + one LineString per segment (sliced from the profile by distance) + the turnaround point. */
export function planToGeoJson(plan, ctx = {}, now = new Date()) {
  const p = plan.profile ?? {};
  const rows = (p.distance_m ?? []).map((d, i) => ({ d, lon: p.lon?.[i], lat: p.lat?.[i] })).filter((r) => r.lon != null && r.lat != null);
  const segmentFeatures = (plan.segments ?? []).map((s, i) => {
    const pts = rows.filter((r) => r.d >= s.from_m && r.d <= s.to_m).map((r) => [r.lon, r.lat]);
    return {
      type: "Feature",
      geometry: pts.length >= 2 ? { type: "LineString", coordinates: pts } : null,
      properties: { kind: "segment", index: i, ...s },
    };
  });
  const features = [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: plan.geometry?.coordinates ?? [] },
      properties: {
        kind: "route",
        status: plan.status?.value ?? null,
        status_reasons: plan.status?.reasons ?? [],
        length_m: plan.summary?.length_m?.value ?? null,
        max_slope_3m_deg: plan.summary?.max_slope_3m_deg?.value ?? null,
        eva_h: plan.budget?.eva_h ?? null,
        outbound_h: plan.budget?.outbound_h ?? null,
        return_h: plan.budget?.return_h ?? null,
        margin_h: plan.budget?.margin_h ?? null,
        display_only: plan.geometry?.display_only ?? false,
      },
    },
    ...segmentFeatures,
  ];
  if (plan.turnaround?.lat != null) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [plan.turnaround.lon, plan.turnaround.lat] },
      properties: { kind: "turnaround", ...plan.turnaround },
    });
  }
  return {
    type: "FeatureCollection",
    crs_note: "IAU Mars 2000 planetocentric lon/lat (degrees east, -180..180); display geometry",
    provenance: provenance({ ...ctx, plan }, now),
    features,
  };
}

const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n#]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function provenanceCsvHeader(meta) {
  return Object.entries(meta)
    .map(([k, v]) => `# ${k}=${typeof v === "object" ? JSON.stringify(v) : v}\n`)
    .join("");
}

export function toCsv(header, rows, meta = {}) {
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
  lines.push(header.join(","));
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

export const PROFILE_COLUMNS = ["distance_m", "elevation_m", "slope_3m_deg", "slope_1m_deg", "slope_3m_baseline_m", "walkability", "class", "source", "cum_time_h", "lat", "lon"];

export function planProfileCsv(plan, ctx = {}, now = new Date()) {
  const p = plan.profile ?? {};
  const n = p.distance_m?.length ?? 0;
  const rows = Array.from({ length: n }, (_, i) => PROFILE_COLUMNS.map((c) => p[c]?.[i]));
  const prov = provenance({ ...ctx, plan }, now);
  return toCsv(PROFILE_COLUMNS, rows, { ...prov, decimated_from: p.decimated_from, pnr_distance_m: p.pnr_distance_m });
}

/* Client bundle around the server's validated v1 brief: plan, conditions at the active sol and provenance. */
export function evaBriefBundle(serverBrief, plan, conditions, ctx = {}, now = new Date()) {
  return {
    schema: BRIEF_BUNDLE_SCHEMA,
    provenance: provenance({ ...ctx, plan, retrievedAt: conditions?.rad?.retrieved_at ?? ctx.retrievedAt ?? null }, now),
    brief: serverBrief,
    conditions_at_active_sol: conditions
      ? { season: conditions.season, dust: conditions.dust, solar: conditions.solar, rad: conditions.rad, weather: conditions.weather }
      : null,
    plan: { plan_id: plan.plan_id, status: plan.status, summary: plan.summary, budget: plan.budget, turnaround: plan.turnaround, request: plan.request },
    note: "Planning limits are not safety limits. Screening estimates for human review.",
  };
}

export function validationMarkdown(latest, now = new Date()) {
  const lines = [`# NeuroNexus validation report`, "", `Run \`${latest.run_id}\` · generated ${latest.generated_at} · exported ${now.toISOString()}`, ""];
  for (const [site, entry] of Object.entries(latest.sites ?? {})) {
    lines.push(`## ${site[0].toUpperCase()}${site.slice(1)}`, "", "| id | metric | value | 95% CI | n | meaning |", "| --- | --- | --- | --- | --- | --- |");
    for (const h of entry.headline ?? []) {
      lines.push(`| ${h.id} | ${h.label} | ${h.value} | ${h.ci95 ? `${h.ci95[0]}–${h.ci95[1]}` : ""} | ${h.n} | ${h.meaning} |`);
    }
    if (entry.V5) lines.push(`| V5 | Plans byte-identical on rerun | ${entry.V5.identical}/${entry.V5.ran} |  | ${entry.V5.ran} | same request + data versions → same plan |`);
    for (const f of entry.figures ?? []) lines.push("", `![${site} figure](${f})`);
    lines.push("");
  }
  if (latest.caveats?.length) lines.push("## Caveats", "", ...latest.caveats.map((c) => `- ${c}`), "");
  return lines.join("\n");
}

export function validationJson(latest, now = new Date()) {
  return { ...latest, provenance: provenance({ extra: { validation_run_id: latest.run_id } }, now) };
}

/* THEMIS heatmap matrix + conditions at the active sol, as JSON or long-form CSV. */
export function thermalSnapshot(data, location, conditions, ctx = {}, now = new Date()) {
  const hm = data?.heatmap ?? {};
  return {
    provenance: provenance({ ...ctx, extra: { ledger_ids: ["THEMIS", "NASA_AMES_MGCM", "NEURONEXUS_SOLAR_GEOMETRY"] } }, now),
    location: location ? { name: location.name ?? null, lat: location.latitude_deg, lon: location.longitude_deg } : null,
    thermal: {
      evidence: "OBSERVED · HISTORICAL (brightness temperature, not surface temperature or weather)",
      radius_km: data?.radius_km ?? null,
      row_bin_h: hm.row_bin_h,
      col_bin_deg: hm.col_bin_deg,
      mean_k: hm.mean_k ?? [],
      counts: hm.counts ?? [],
      stats: data?.stats ?? null,
      count: data?.count ?? 0,
    },
    conditions_at_active_sol: conditions ?? null,
  };
}

export function thermalCsv(snapshot) {
  const { mean_k: grid = [], counts = [], row_bin_h: rowH, col_bin_deg: colDeg } = snapshot.thermal;
  const rows = [];
  grid.forEach((row, r) => row.forEach((v, c) => rows.push([r * rowH, (r + 1) * rowH, c * colDeg, (c + 1) * colDeg, v, counts[r]?.[c] ?? 0])));
  return toCsv(["lst_from_h", "lst_to_h", "ls_from_deg", "ls_to_deg", "mean_tb_k", "n"], rows, snapshot.provenance);
}

export function downloadText(filename, text, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
