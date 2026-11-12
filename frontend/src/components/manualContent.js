/* Mission Operations Manual: quick starts and guides (plain data so tests can check them). */

export const DEMOS = {
  gale: { id: "gale", site: "gale", label: "Gale Crater Marswalk Demo", targets: [{ lat: -4.824665, lon: 137.367297 }], evaHours: 4, groundTruth: false },
  jezero: { id: "jezero", site: "jezero", label: "Jezero Out-of-Sample Check", targets: [{ lat: 18.452465, lon: 77.232875 }], evaHours: 4, groundTruth: false },
  groundTruth: { id: "ground-truth", site: "gale", label: "Rover Ground-Truth Validation", targets: [{ lat: -4.824665, lon: 137.367297 }], evaHours: 4, groundTruth: true },
};

export const QUICK_STARTS = [
  { id: "demo-90s", label: "90-Second Demo", demo: "gale", note: "Gale: 1 m terrain, route, turnaround, profile, decision card; then toggle GROUND TRUTH and MOLA ONLY." },
  { id: "demo-gale", label: DEMOS.gale.label, demo: "gale", note: "4-hour EVA from Curiosity's latest position (stand-in habitat) to a target 1.2 km west." },
  { id: "demo-jezero", label: DEMOS.jezero.label, demo: "jezero", note: "Same pipeline, no re-tuning. Perseverance is on the western rim: the ladder falls back to CTX and says so." },
  { id: "demo-ground-truth", label: DEMOS.groundTruth.label, demo: "groundTruth", note: "Curiosity's real drives over the planned route, with the V1-V6 validation scorecard." },
];

export const GUIDES = [
  {
    id: "ladder",
    title: "Terrain Resolution Ladder (HiRISE 1 m → CTX 20 m → MOLA 463 m)",
    body: [
      "Every pixel takes the best available product: a HiRISE DTM (about 1 m) where one covers it, otherwise a QA-gated CTX DTM (about 20 m), otherwise MOLA (463 m).",
      "Each product is checked against MOLA before use (median offset and NMAD); 404 or mismatched products are listed as UNAVAILABLE or EXCLUDED, never filled in.",
      "Slope on a CTX or MOLA pixel is computed at that product's own resolution and labeled with its baseline. Switch to MOLA ONLY to see what orbital topography alone misses.",
    ],
  },
  {
    id: "eva",
    title: "EVA planner, turnaround point (PNR), time and metabolic budgets",
    body: [
      "Pace follows Tobler's hiking function normalized to the flat pace (Naismith optional). The walk back is timed on the same route in reverse.",
      "The turnaround point is the first place where outbound plus walk-back time reaches (1 − reserve) × EVA duration.",
      "Metabolic rate, O₂ and cooling water use a gravity-scaled Pandolf equation: a MODELED screening proxy with a ±30% band, not a flight rule.",
    ],
  },
  {
    id: "limits",
    title: "Planning limits are not safety limits",
    body: [
      "Statuses are WITHIN PLANNING LIMITS, REVIEW REQUIRED and EXCEEDS PLANNING LIMIT. NeuroNexus never labels terrain safe.",
      "Every limit lives in one config file and is tagged either a published value (with citation) or a NeuroNexus planning choice. Sliders show the tag.",
      "Rocks under 1-2 m, ripples and regolith strength are below DTM resolution and are not represented.",
    ],
  },
  {
    id: "layers",
    title: "Categorized layers, the map legend and the THEMIS heatmap",
    body: [
      "LAYERS groups overlays into Topography, Geology and Science, Atmosphere and Environment, and Missions and Ground Truth.",
      "MAP LEGEND shows keys only for active layers. The THEMIS card plots historical brightness temperatures by local time and season.",
    ],
  },
  {
    id: "tags",
    title: "Reading 🏷️ source tags",
    body: [
      "Each tag reads 🏷️ EVIDENCE CLASS · source · product or basis. The class is always written as text.",
      "Click a tag (or press Enter or Space) for the ledger entry: organization, product, DOI or URL, license, retrieval date and caveats. View in ledger opens the Sources drawer.",
    ],
  },
];
