# NeuroNexus Mission Console v2 — Architecture

Branch: `feature/mission-console-v2` (from `Master-Ai-Backup-2`)
Status: **Implemented** on `feature/mission-console-v2` (see §11 for what shipped and the deviations)
Date: 2026-10-14

---

## 1. Scope

This document covers five workstreams. They share one set of foundations, so they are designed together.

| ID | Workstream | Operator outcome |
|----|------------|------------------|
| **W1** | Dust scenario graphics (right panel) | See *how dusty the site is now*, *how that compares across the Mars year*, and *where the dust is globally* in one glance. |
| **W2** | Site morphology statistics | Elevation, slope and roughness shown as **AT SITE / MIN / MEAN / MAX** over a stated window, not a single 3×3 sample. |
| **W3** | Mission Command Index (hamburger menu) | Every capability in the UI reachable from one categorised, searchable menu, with a reason shown when an action is unavailable. |
| **W4** | Saved routes in the 3D view | All saved routes drawn in 3D, toggled, flown to and compared there, with the same colours as 2D. |
| **W5** | Route comparison + USGS snapshots | Every saved route carries along-track **min / mean / max** elevation, slope and roughness, plus its own USGS SIM 3292 snapshot. Comparison is side by side with best and worst marked per row. |

Out of scope: new routing algorithms, real-time (non-modeled) weather, multi-user sync.

---

## 2. Design principles (the flight-controller bar)

These rules are written for an operator with decades in a Mars mission back room. That operator works under time pressure, distrusts unlabeled numbers, and has to defend every go/no-go call afterwards. Every workstream is reviewed against them.

1. **No orphan numbers.** Every value shows its unit, its source (MOLA, Ames GCM, THEMIS, USGS) and its *basis*, meaning the point, window size, along-track sample count or sol. If the value is missing, the display says why: "outside MOLA window", "backend degraded" or "fewer than 2 valid samples". It never shows a bare "—".
2. **Keep the data classes separate.** The existing *Observed · Modeled · Derived · Simulated* taxonomy (evidence bar) applies to every new graphic. Dust is **Modeled (MY34 scenario)** and must never look like a live forecast. Morphology statistics are **Derived** from MOLA.
3. **Statistics have a fixed order and fixed semantics.** It is always `MIN · MEAN · MAX`, left to right, with the same units in all three. The point value at the site is labelled **AT SITE** and kept visually separate from the window statistics. This follows the convention the THEMIS panel already uses: nearest value separate from aggregates.
4. **Nominal recedes, off-nominal stands out.** The base styling is soft cyan glow. Amber and red are reserved for threshold crossings that come from backend constants (`classify_dust`, `routing/metrics.REFERENCES`). The frontend invents no thresholds.
5. **One truth across all views.** A saved route has one colour, one name and one stats record. That holds in 2D, 3D, the comparison workspace, the snapshot and the export.
6. **Degraded modes are designed, not accidental.** Each new component defines loading, empty, error and partial-coverage states before its happy path.
7. **Discoverable and fast.** Every action is in the Command Index, reachable by keyboard, and never more than two interactions from anywhere.
8. **Reproducible.** Every graphic can be exported as data (JSON/CSV) together with its provenance. A screenshot alone does not count as a record.

---

## 3. Current state (verified on this branch)

| Area | Finding | Location |
|------|---------|----------|
| Dust panel | Three text metrics (opacity, class, height) from a single-point, single-sol sample. | [App.jsx:3645](../../frontend/src/App.jsx#L3645) |
| Sol | Hard-coded `DEFAULT_SOL = 100`. There is no sol control, so the dust shown never changes with time. | [App.jsx:40](../../frontend/src/App.jsx#L40) |
| Dust data | `DustScenario_MY34.nc`: `tau`, `taufill`, `zmax` on 668 sols × 60 lat × 120 lon (3° grid), plus `areo` (Ls) per sol. A 58 MB copy also sits in the repo root and is unused. The code reads `external/mars-gcm/data/`. | [dust.py](../../science/weather/ingestion/dust.py) |
| Dust thresholds | `classify_dust`: <0.2 low, <0.5 moderate, <1.0 high, ≥1.0 very_high. | [environment_assessment.py](../../science/weather/models/environment_assessment.py) |
| Site morphology | Center sample from a 3×3 MOLA window. Only elevation has local min/max, and slope and roughness have no stats. | [terrain_assessment.py](../../science/weather/models/terrain_assessment.py) |
| Window stats | `GET /terrain/window` (≤20 km) already returns per-pixel grids plus `summary` with elevation min/max, slope max/mean and roughness max/mean. It is missing elevation mean, slope min and roughness min. | [terrain/api.py:192](../../science/terrain/api.py#L192) |
| Hamburger | Opens only "Field notes + checklist" and exports. Top-bar buttons, map floating buttons, the route console and the 3D toolbar each hold different, partly duplicated actions. | [App.jsx:262](../../frontend/src/App.jsx#L262) |
| 3D compare | The 3D `⇄ COMPARE` button opens the shared comparison workspace (z 4000 > 3D shell 3990). **Saved routes are never passed to `Mars3DView`**, so the 3D globe cannot show them. Comparison is drawn only in a 2D `ComparisonMap`. | [App.jsx:3812](../../frontend/src/App.jsx#L3812), [Mars3DView.jsx:858](../../frontend/src/components/mars3d/Mars3DView.jsx#L858) |
| Saved-route stats | `buildRouteMetrics` uses **waypoint samples only** (3×3 at each clicked point), not the path between them. A 30 km leg across a scarp can therefore report a gentle slope. | [App.jsx:1063](../../frontend/src/App.jsx#L1063) |
| Along-track stats | `POST /routes/evaluate` already samples densely along the path (`summarise_samples`). It returns mean/max slope, mean/max roughness, elevation min/max, gain/loss, p90 slope, burden, risk and data support, but no min slope, min roughness or mean elevation. | [routing/metrics.py:202](../../science/routing/metrics.py#L202) |
| USGS snapshot | One snapshot at a time, for the active route or candidate only. Saved routes cannot be snapshotted. | [App.jsx:2822](../../frontend/src/App.jsx#L2822) |
| Orphaned UI | `HazardDefencePanel`, `RouteComparisonPanel`, `RouteCompareOverlay`, `RouteUpgradeTools`, `UtilityDrawer` and `MarsMapInteractionLayer` are imported nowhere. | `frontend/src/components/**` |
| Styling | Cyan `#75e6ff` and the panel colours are repeated as inline literals across `App.jsx` (3,913 lines) and `App.css`. There are no design tokens and no charting library. | — |
| Working tree | 21 LFS-tracked MOLA files show as modified. This looks like LFS pointer/smudge drift, not real edits, and must not be committed. | `data/raw/mola/meg128/**` |

---

## 4. Target architecture

```
┌──────────────────────────────── FRONTEND (React 19 + Vite) ────────────────────────────────┐
│                                                                                            │
│  App shell (layout only, < 800 lines after extraction)                                     │
│   ├─ TopBar ── CommandIndexButton ─┐                                                       │
│   ├─ LeftColumn                    │      ┌───────────── features/registry.js ───────────┐  │
│   ├─ SiteField (2D + USGS maps)    ├─────▶│ one entry per capability:                     │  │
│   ├─ RightColumn                   │      │ {id, category, label, icon, shortcut,         │  │
│   │   ├─ DustScenarioPanel  (W1)   │      │  run(ctx), available(ctx) → {ok, reason}}     │  │
│   │   ├─ SiteMorphologyPanel(W2)   │      └───────────────────────────────────────────────┘  │
│   │   └─ … existing panels         │            ▲ consumed by: CommandIndex (W3), TopBar,   │
│   ├─ Mars3DView ── SavedRoutesLayer + RoutesSidePanel (W4)    3D toolbar, keyboard map     │
│   ├─ RouteComparisonWorkspace (W5)                                                         │
│   └─ CommandIndex (W3)                                                                     │
│                                                                                            │
│  State (React context, no new dependency)                                                  │
│   ├─ MissionContext   : selection, sol, environment, missionProfile                        │
│   ├─ RoutesContext    : savedRoutes (schema v3), compareIds, visibility, colours           │
│   └─ hooks            : useDustSeries, useDustMap, useTerrainStats, useRouteEvaluation,    │
│                         useRouteSnapshot  (fetch + abort + in-memory LRU cache)            │
│                                                                                            │
│  UI primitives  (ui/)                                                                      │
│   ├─ tokens.css       : --nn-cyan, --nn-glow, --nn-amber, --nn-red, panel surfaces          │
│   ├─ StatTriplet      : AT SITE | MIN · MEAN · MAX row with unit + basis                    │
│   ├─ NeonLineChart    : SVG, glow filter, cursor marker, threshold bands, a11y table        │
│   ├─ NeonHeatmap      : <canvas> grid + SVG crosshair                                       │
│   └─ ProvenanceTag    : OBSERVED / MODELED / DERIVED / SIMULATED chip + source              │
│                                                                                            │
│  Persistence: localStorage (route records, small)  ·  IndexedDB (snapshot images, large)   │
└────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                             │ /api (Vite proxy)
┌────────────────────────────────────────────▼───────────── BACKEND (FastAPI) ──────────────┐
│  NEW  GET  /dust/timeseries?latitude&longitude           → 668-sol series at nearest cell  │
│  NEW  GET  /dust/map?sol[&decimate]                      → 60×120 tau grid for one sol     │
│  NEW  GET  /dust/meta                                    → units, normalisation, Ls↔sol    │
│  EXT  GET  /terrain/window   summary gains full min/mean/max triplets + valid count        │
│  EXT  POST /routes/evaluate  summary gains min/mean triplets + elevation profile (decim.)   │
│  EXT  POST /usgs/route-snapshot  accepts `routes: [...]` for a combined multi-route frame   │
│  (unchanged) /environment, /routes/candidates, /mars3d/*, /usgs/sync                       │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Shared foundations (built first, used by all workstreams)

**Design tokens** (`frontend/src/ui/tokens.css`). These are extracted from existing literals so nothing changes visually.

```css
:root {
  --nn-cyan: #75e6ff;            /* primary signal */
  --nn-cyan-dim: rgba(117,230,255,0.22);
  --nn-glow: 0 0 6px rgba(117,230,255,0.55), 0 0 18px rgba(117,230,255,0.18);
  --nn-surface: #091115;
  --nn-surface-2: #081014;
  --nn-border: #29414b;
  --nn-text: #a8bbc1;  --nn-text-dim: #71848c;
  --nn-green: #8cf0b1;  --nn-amber: #ffc46b;  --nn-red: #ff647c;
  --nn-series: #75e6ff, #ff9f68, #8cf0b1, #c99bff;   /* = COMPARISON_COLOURS */
}
```

**Neon chart style.** Lines are drawn with `stroke: var(--nn-cyan)` at 1.5 px. They glow through an SVG `<filter>` (a `feGaussianBlur` of stdDeviation 2.5, merged under the source graphic), not CSS `filter`, so the effect stays crisp when exported. Under the line sits an area fill: a vertical gradient from cyan at 18% to 0%. Grid lines use `--nn-cyan-dim` at 0.5 px, and axis text uses the existing monospace, 9 px, letter-spacing 0.06em. The "now" cursor is a vertical line with a pulsing dot that uses the same `@keyframes` as `.status-dot`. Threshold bands are tinted 6–8% fills of amber and red, drawn only where the backend classification changes. Every chart also renders a visually hidden `<table>` for screen readers and for "copy data".

**Charting approach.** Charts are hand-rolled SVG and canvas, with no new dependency. The data is small (≤668 points per series and ≤7,200 cells per map), and the glow look is easier to control without a library. Each chart is under 200 lines.

**`StatTriplet`** is a single component for every min/mean/max display (W2, W5, and later THEMIS):

```
SLOPE            AT SITE   MIN     MEAN    MAX       basis
                 3.2°      0.4°    4.1°    18.7°     4×4 km · 1,024 px
```

**Saved route record, schema v3.** The localStorage key becomes `neuronexus.savedRoutes.v3`, and v2 records are migrated lazily.

```jsonc
{
  "id": "route-…", "name": "Marswalk 1", "createdAt": "…", "colourIndex": 0,
  "points": [ … ], "plan": { … },                      // unchanged from v2
  "geometryHash": "sha1(points)",                       // cache key for evaluation + snapshot
  "evaluation": {                                       // from POST /routes/evaluate
    "status": "ok" | "pending" | "error",
    "evaluatedAt": "…", "sampleSpacingKm": 0.46, "sampleCount": 812, "dataSupportPct": 99.1,
    "elevation_m":  { "min": …, "mean": …, "max": … , "gain": …, "loss": … },
    "slope_deg":    { "min": …, "mean": …, "max": …, "p90": … },
    "roughness_m":  { "min": …, "mean": …, "max": … },
    "distanceKm": …, "evaHours": …, "terrainRisk": …, "terrainBurden": …,
    "profile": [[distKm, elevM, slopeDeg], …]           // decimated to ≤256 rows
  },
  "snapshotRef": "idb:snapshot/<geometryHash>"          // image lives in IndexedDB, not localStorage
}
```

Snapshot images go to IndexedDB because localStorage's roughly 5 MB quota would fill after a few stitched tiles.

**Registry coverage test.** A unit test walks every `data-feature-id` attribute rendered in the app and asserts that each has a registry entry. This enforces the W3 promise that every feature appears in the menu.

---

## 5. Workstream designs

### W1 — Dust scenario graphics (right panel)

**Backend** (`science/weather/api/dust.py`, mounted in `environment.py`)

| Endpoint | Response | Notes |
|----------|----------|-------|
| `GET /dust/timeseries?latitude&longitude` | `{cell:{lat,lon}, sol[], ls[], tau[], zmax_km[], taufill_flag[], source, data_class:"MODELED"}` | One vectorized `ds.sel(lat, lon, method="nearest")`, about 8 KB of JSON. Wraps longitude to 0–360. `lru_cache` keyed on the grid cell, not raw coordinates. |
| `GET /dust/map?sol` | `{sol, ls, lat[60], lon[120], tau:[[…]], range:{min,max}, source}` | Values rounded to 3 decimal places, about 30 KB. Cached per sol. |
| `GET /dust/meta` | `{units, normalisation, grid_deg:3, sols:668, levels:{low:0.2,…}}` | Thresholds read from `classify_dust`, so the frontend never hard-codes them. |

**Frontend: `DustScenarioPanel`** (replaces the current three-metric panel). The vertical order fits the roughly 320 px right column.

```
ATMOSPHERE / NASA AMES                                    [MODELED · MY34]
Dust scenario                                    cell 4.5°S 136.5°E (3° grid)
┌───────────────────────────────────────────────────────────────┐
│ τ NOW  0.412  MODERATE      DUST TOP 38.2 km      Ls 112.4°    │  ← KPI strip
├───────────────────────────────────────────────────────────────┤
│  τ  ╭╮                          ╭───╮  GDS                     │  ← NeonLineChart
│     │╰──╮      ●now        ╭────╯   ╰──╮                       │    opacity over 668 sols
│ ────┴───┴──────┴───────────┴──────────┴──── sol / Ls ticks     │    threshold bands tinted
├───────────────────────────────────────────────────────────────┤
│  zmax ▁▂▂▃▃▅▇█▆▄▃▂  (sparkline, same x-axis)                   │  ← dust-top height
├───────────────────────────────────────────────────────────────┤
│ [ global τ map, 3° grid, canvas, crosshair on site ]          │  ← NeonHeatmap, click = select
├───────────────────────────────────────────────────────────────┤
│ ◀ ▶  ▶PLAY   SOL ━━━━━━━●━━━━━━━━━━  100 / 668                 │  ← sol scrubber
└───────────────────────────────────────────────────────────────┘
 Source: NASA Ames Mars GCM MY34 dust scenario · modeled, not a forecast
```

- **Sol becomes app state.** `DEFAULT_SOL` turns into `MissionContext.sol`. The scrubber updates the chart cursor and map instantly from cached data, and refetches `/environment` only after 300 ms of inactivity, so dragging stays smooth.
- **Heatmap colour.** The ramp runs from a dark surface to cyan to white, so it matches the theme. The amber and red contour lines at τ = 0.5 and 1.0 match the backend classes.
- **Interaction.** Hovering the line chart shows sol, Ls, τ and zmax. Clicking the chart sets the sol. Clicking the map selects that coordinate through the existing `handleSelectCoordinate`.
- **Degraded states.**
  - Time series failed to load: the KPI strip still shows the `/environment` values.
  - `taufill` flag set for a sol: the chart segment is dashed and labelled "filled".
  - Polar cells: shown as-is, with a note.
- **Sizing.** The map renders at 240×120 CSS px, and clicking it opens a larger modal map.

> **Open science question (must resolve before labelling axes).** We need to confirm from `external/mars-gcm/docs` whether `tau` is visible or 9.3 µm IR column optical depth, and whether it is normalised to 610 Pa. An expert operator will ask, and the axis label and the `classify_dust` thresholds both depend on the answer.

### W2 — Site morphology statistics

**Backend.** Extend the `summary` of `/terrain/window` to full triplets over valid pixels only, and keep the old keys for compatibility:

```jsonc
"summary": {
  "elevation_m": {"min":…, "mean":…, "max":…},
  "slope_deg":   {"min":…, "mean":…, "max":…, "p90":…},
  "roughness_m": {"min":…, "mean":…, "max":…},
  "valid_pixels": 1021, "total_pixels": 1024,
  // legacy: elevation_min_m, elevation_max_m, slope_max_deg, slope_mean_deg, roughness_max_m, roughness_mean_m
}
```

**Frontend: `SiteMorphologyPanel`.** It uses `useTerrainStats(location, windowKm)`, with the window selectable as `[2] [4] [10] [20] km` (default 4) and persisted per viewer.

```
TERRAIN / NASA MOLA                                       [DERIVED · MOLA 128 ppd]
Site morphology                                  window [2][4][10][20] km
              AT SITE    MIN      MEAN     MAX
ELEVATION     -4,412 m   -4,530   -4,402   -4,118
SLOPE           3.2°       0.4°     4.1°    18.7°   ▕▁▂▅█▃▁▏ ← mini histogram (optional)
ROUGHNESS      12.0 m      1.1     14.6     61.3
ASPECT        214.0°   (point value only; circular quantity, no mean)
basis: 4×4 km window · 1,021/1,024 valid px · NASA MOLA MEGDR
```

- **AT SITE** comes from `/environment` (unchanged). The statistics come from `/terrain/window`. The two are visually separated, per principle 3.
- **Aspect** gets no mean. A plain arithmetic mean of a circular quantity is wrong, so a circular mean is a possible later addition.
- **Polar fallback.** `/terrain/window` is limited to |lat| ≤ 88°. Beyond that, the panel shows the existing `local_elevation_min_m/max_m` and the label "polar: 3×3 sample only".
- **Threshold glow.** A MAX slope above `REFERENCES.risk_max_slope_deg` (30°) or roughness above 100 m turns that cell amber, using the backend constants exposed via `/routes/methodology`.

### W3 — Mission Command Index (hamburger menu)

The ☰ menu becomes a categorised command palette. Field notes and the checklist move into a tab inside it, so nothing is lost.

**Layout:** a full-height glass sheet on the right, about 420 px wide, using the existing blur and border styles. It has a search box at the top, collapsible categories, and a tab strip: `COMMANDS · FIELD NOTES · CHECKLIST`.

**Categories and initial entries.** Each entry shows label, shortcut, status, and a disabled reason when it is unavailable.

| Category | Commands (from the current UI) |
|----------|--------------------------------|
| **Site & Navigation** | Search place (`/`), Select coordinate, Save place, Add safe haven, Jump to safe haven, Sync USGS map |
| **Route Planning** | Toggle route mode (`R`), Add selected as waypoint, Remove last waypoint, Clear route, Analyze route, Save route (`S`), AI Route Design (`A`) |
| **Saved Routes** | Open route library, Compare routes (`C`), Show all routes on 3D, USGS snapshot per route, Delete route |
| **Analysis & Intelligence** | Mars Intelligence (`I`), Route analysis (AI), Hazard overview\*, Route methodology |
| **Environment** | Dust scenario: play/pause sol, Set sol, Open global dust map, THEMIS thermal history |
| **Views** | 3D map (`3`), 3D layers, 3D legend, Potential exploration zones, USGS scientific map |
| **Mission Ops** | Crewed console / mission profile, Orbital tracking (`O`), Mars reference feed |
| **Data & Export** | Export mission JSON, mission CSV, route CSV, comparison CSV/JSON, snapshot JSON, Print briefing (`P`) |
| **Workspace** | Field notes, Checklist |
| **System** | Backend status, data provenance ledger (`/ai/provenance`), keyboard shortcuts (`?`) |

\* `HazardDefencePanel` exists but is orphaned. We must either wire it in or delete it, and the registry test forces that choice.

**Mechanics**
- `features/registry.js` is the single source of truth. Top-bar buttons, map floating buttons and the 3D toolbar render **from** the registry, so a label or a disabled rule cannot drift between places.
- `available(ctx)` returns `{ok:false, reason:"Needs ≥2 waypoints"}`. The reason is shown inline, never as a silently greyed button.
- Keyboard: `Ctrl/⌘+K` opens the palette. Single-key shortcuts are active only when focus is not in a text input. Arrow keys and Enter run a command, and Esc closes the palette.
- Accessibility: `role="dialog"`, a focus trap, `aria-keyshortcuts`, and visible focus rings in cyan glow.

### W4 — Saved routes in the 3D view

**Data flow:** `RoutesContext` passes `savedRoutes`, `compareIds`, `visibility` and `colours` to `Mars3DView`.

**Rendering.** A new draped `GraphicsLayer` named `savedRoutesLayer` reuses the existing `draped()` factory ([Mars3DView.jsx:267](../../frontend/src/components/mars3d/Mars3DView.jsx#L267)).
- Each route is a polyline in its `COMPARISON_COLOURS[colourIndex]`, 3 px wide, with a 7 px under-stroke at 25% alpha to create the glow.
- Waypoints are small discs, with labeled start and end markers.
- In **compare mode**, the compared routes stay at full intensity and all other saved routes dim to 25%.
- The graphics layer is diffed by `geometryHash`, so toggling visibility never rebuilds all graphics.

**New `ROUTES` side panel.** It is added to the existing `sidePanel` modes (`layers | legend | pez | routes`):

```
SAVED ROUTES (5)                     [show all] [hide all]
■ Marswalk 1   12.4 km  ⛰ +312/-120 m   👁 ✈ ⇄ ▣
■ Marswalk 2    9.8 km  ⛰ +88/-410 m    👁 ✈ ⇄ ▣
…
👁 visibility · ✈ fly-to (frame route extent) · ⇄ add to compare · ▣ USGS snapshot
[ ⇄ COMPARE SELECTED (2/4) ]
```

- The `⇄ COMPARE` toolbar button keeps its behaviour, opening the shared workspace above the 3D shell. In addition, selections made inside the 3D panel feed the same `compareIds`.
- Selecting a route in 3D also opens a compact stats card using `StatTriplet`, with the same numbers as W5.
- The 3D view adds a Route elevation profile button. ArcGIS `ElevationProfile` is already loaded, but our own `evaluation.profile` is preferred for consistency with 2D.

### W5 — Route comparison + USGS snapshots

**1. Along-track evaluation for every saved route.**
- On save, call `POST /routes/evaluate` with the route coordinates and store the result in `evaluation` (status `pending` → `ok` or `error`).
- Old v2 routes are backfilled lazily the first time the comparison workspace opens, with a progress indicator ("Evaluating 3 legacy routes…").
- Backend: extend `summarise_samples` with `min_slope_deg`, `min_roughness_m` and `mean_elevation_m`. Add an optional `include_profile=true` that returns ≤256 decimated `[dist_km, elev_m, slope_deg]` rows.
- `buildRouteMetrics` becomes a pure adapter over `evaluation`. If evaluation is unavailable, it falls back to the waypoint-only numbers, labelled **"waypoints only — not along-track"**.

**2. Comparison workspace** (it replaces the inline `RouteComparisonWorkspace` and absorbs the orphaned `RouteComparisonPanel` and `RouteCompareOverlay` ideas):

```
COMPARE MARSWALK ROUTES                   [2D MAP | 3D | PROFILE]   [EXPORT CSV] [EXPORT JSON] [×]
Routes: ■ Marswalk 1 ✓  ■ Marswalk 2 ✓  ■ Marswalk 3 ✓  ■ Marswalk 4   (max 4)

┌ map / 3D / overlaid elevation-profile chart (all routes, neon series colours) ┐
└───────────────────────────────────────────────────────────────────────────────┘

METRIC                    ■ MW1            ■ MW2            ■ MW3        BEST
Distance (km)             12.4             9.8 ★            15.1         MW2
EVA time (h)              5.6              4.3 ★            7.0          MW2
Elevation  min/mean/max   -4,530/-4,402/-4,118 …
Elev. gain / loss (m)     +312 / -120      +88 / -410 ★     …
Slope      min/mean/max   0.4 / 4.1 / 18.7 …                             (max ↓ better)
Slope p90 (°)             …
Roughness  min/mean/max   …
Terrain risk (0-100)      …
Data support (%)          99.1             97.4             72.0 ⚠
Basis                     812 samples @0.46 km · MOLA 128 ppd · DERIVED

USGS SNAPSHOTS
┌ MW1 ▣ ┐ ┌ MW2 ▣ ┐ ┌ MW3 ▣ ┐   [▣ COMBINED SNAPSHOT — all compared routes on SIM 3292]
```

- **Best and worst marking.** Each metric declares a `better: "lower" | "higher" | "none"` direction. Best gets a ★ and soft green glow, and worst gets an amber outline. Elevation triplets are informational (`none`).
- **Profile tab.** One `NeonLineChart` overlays all compared routes, with distance on x and elevation on y. A slope strip below it is coloured by the backend risk bands.
- **Per-route snapshots.**
  - `useRouteSnapshot(route)` calls the existing `POST /usgs/route-snapshot` with that route's coordinates and caches the result in IndexedDB by `geometryHash`.
  - Tiles load lazily, at most 2 at a time.
  - Each snapshot card shows the geologic units crossed (already in the snapshot payload) together with the route's stats triplets.
- **Combined snapshot.** Extend the request to `{routes: [{id, name, colour, coordinates}]}`. The backend computes the union extent and draws each route in its colour. One map frame serves the whole comparison briefing.
- **Exports.** Comparison CSV (one row per route per metric) and JSON (full `evaluation` plus provenance). The print stylesheet lays out one page per comparison.

---

## 6. Data contracts (summary)

| Contract | Owner | Consumers |
|----------|-------|-----------|
| `DustSeries`, `DustMap`, `DustMeta` | `science/weather/api/dust.py` | `useDustSeries`, `useDustMap` → W1 |
| `TerrainWindowSummary` (triplets) | `science/terrain/api.py` | `useTerrainStats` → W2 |
| `RouteEvaluation` (triplets + profile) | `science/routing/metrics.py`, `api.py` | `useRouteEvaluation` → W4, W5, export |
| `MultiRouteSnapshotRequest` | `science/usgs/api.py` | `useRouteSnapshot` → W5 |
| `SavedRoute v3` | `RoutesContext` | 2D, 3D, compare, export, AI mission state |
| `FeatureRegistryEntry` | `features/registry.js` | CommandIndex, TopBar, 3D toolbar, shortcuts |

All new backend responses carry `source`, `dataset`, `data_class` and `method` keys. This matches the existing provenance style and lets Mars Intelligence cite them.

---

## 7. Refactor strategy for `App.jsx`

Extraction happens alongside the feature work, never as a separate big-bang PR:

1. `ui/` primitives, plus `tokens.css`: replace inline literals only in the code each PR touches.
2. `panels/DustScenarioPanel.jsx` and `panels/SiteMorphologyPanel.jsx` (W1, W2).
3. `state/RoutesContext.jsx`: move saved routes, compare, persistence and v2→v3 migration out of App (W4, W5).
4. `route/RouteComparisonWorkspace.jsx`, which supersedes the inline version (W5).
5. `command/CommandIndex.jsx` and `features/registry.js` (W3).
6. Delete the orphaned components that the registry review confirms are unused.

Target: `App.jsx` below 1,500 lines at the end of this branch.

---

## 8. Delivery plan

Each phase is a reviewable PR into `feature/mission-console-v2`.

| Phase | Content | Depends on | Size |
|-------|---------|------------|------|
| **P0 Hygiene** | Resolve the LFS drift. Remove or relocate the root `DustScenario_MY34.nc`. Answer the dust normalisation question. | — | S |
| **P1 Foundations** | `tokens.css`, `NeonLineChart`, `NeonHeatmap`, `StatTriplet`, `ProvenanceTag`. Add vitest. | P0 | M |
| **P2 W2 Morphology** | Window triplets backend + panel + window selector + tests. | P1 | S |
| **P3 W1 Dust** | `/dust/*` endpoints + tests; sol state; panel with chart, sparkline, map, scrubber. | P1 | M |
| **P4 Route data** | `summarise_samples` triplets + profile; `RoutesContext`; schema v3 + migration; evaluate-on-save. | P1 | M |
| **P5 W4 3D routes** | `savedRoutesLayer`, ROUTES side panel, fly-to, compare highlighting. | P4 | M |
| **P6 W5 Compare** | New workspace, triplet table, profile overlay, per-route + combined snapshots, IndexedDB cache, exports. | P4 | L |
| **P7 W3 Command Index** | Registry, palette, shortcuts, tabs for notes/checklist; top bar + 3D toolbar render from registry; coverage test. | P2–P6 | M |
| **P8 Hardening** | Degraded-mode pass, a11y pass, print layout, README screenshots, merge to `Master-Ai`. | all | S |

W3 comes last on purpose. The registry has to list the commands that W1, W2, W4 and W5 add.

---

## 9. Verification

- **Backend (pytest).**
  - Dust: shape, lon wrap (−180/360 inputs), nearest-cell stability, sol bounds, `taufill` flag.
  - Terrain triplets: `min ≤ mean ≤ max`, valid-pixel accounting, polar rejection message.
  - Evaluation: triplets on `tests/synthetic_terrain.py` with known slopes.
  - Multi-route snapshot extent.
- **Frontend (vitest, new).**
  - Metric direction and best/worst logic.
  - v2→v3 migration.
  - Registry coverage: every `data-feature-id` is registered.
  - `available()` reasons.
- **Operator acceptance**, run on the live app:
  1. Select Gale and scrub to the MY34 global dust storm (Ls ≈ 190–260). The τ chart, map and KPI agree, and the label says MODELED.
  2. Select Olympus Mons and switch windows from 4 to 20 km. Slope MAX rises and the basis line updates.
  3. Save 3 routes. All 3 appear in 3D with matching colours. Compare 2 from inside 3D: the table shows along-track triplets, and each route has its own snapshot.
  4. Open ☰. Every top-bar, map and 3D button can be found by search, and disabled entries state why.
  5. Kill the backend. Every panel shows a designed degraded state, and none shows a blank "—".

---

## 10. Risks and open questions

| Risk / question | Mitigation |
|-----------------|------------|
| Dust `tau` wavelength and normalisation unknown | P0 task. Confirm from the GCM docs before choosing axis labels and thresholds. |
| `/routes/evaluate` latency on long routes (≥100 km) | Evaluate asynchronously after save, show `pending`, and keep waypoint-only numbers until it completes. Cap the profile at 256 rows. |
| USGS ArcGIS tile stitching is slow or rate-limited | Use the IndexedDB cache, fetch at most 2 at a time, and keep the combined snapshot on demand only. |
| localStorage quota | Store only route records (KB) there. Images go to IndexedDB. |
| 3D performance with many routes | Diff graphics by `geometryHash`. Above 20 saved routes, default to compared plus visible only. |
| Registry drift | The coverage test fails CI when a button has no registry entry. |
| Single-key shortcuts conflicting with ArcGIS keyboard nav | Single-key shortcuts are off while the 3D view has focus. `Ctrl/⌘+K` always works. |

---

## 11. Implementation record (2026-10-14)

### Shipped

| Item | Where |
|------|-------|
| P0: the dust quantity is confirmed from the Ames MGCM V3.2 User Guide §2.3 as the Montabone et al. (2015) normalised dust-column climatology. The root `DustScenario_MY34.nc` is kept and used as the fallback when the submodule is absent. | `science/weather/config.py` |
| `/dust/meta`, `/dust/timeseries`, `/dust/map`; one shared `DUST_LEVELS` constant | `science/weather/api/dust.py`, `environment_assessment.py` |
| `/terrain/window` summary returns MIN/MEAN/MAX triplets (plus slope p90 and valid-pixel count); legacy keys are kept | `science/terrain/api.py` |
| Along-track `min_slope_deg`, `min_roughness_m`, `mean_elevation_m`; opt-in `profile` (≤256 rows, merged across segments) | `science/routing/metrics.py`, `engine.py`, `api.py` |
| `/usgs/route-snapshot` accepts `routes: [...]` for one combined frame | `science/usgs/api.py`, `arcgis.py` |
| Design tokens, `NeonLineChart`, `NeonHeatmap`, `StatTable`, `ProvenanceTag` | `frontend/src/ui/` |
| W1 Dust panel; the console sol is now state (persisted; the environment refetches after the sol settles) | `frontend/src/panels/DustScenarioPanel.jsx`, `App.jsx` |
| W2 Site morphology panel (2/4/10/20 km windows, polar fallback, amber flags from the engine's references) | `frontend/src/panels/SiteMorphologyPanel.jsx` |
| W3 Command Index: 45 commands in 10 categories, search, keyboard, disabled reasons, Notes/Checklist and Team tabs, Meet the Team | `frontend/src/features/commands.json`, `registry.js`, `command/CommandIndex.jsx` |
| W4 Saved routes in 3D: draped glow layer, compare dimming, ⌁ ROUTES panel (show/hide, fly-to, compare, USGS) | `components/mars3d/Mars3DView.jsx` |
| W5 Saved route schema v3 with evaluate-on-save, along-track triplets, profiles, best/worst table, per-route and combined USGS snapshots cached in IndexedDB, CSV/JSON export | `utils/savedRoutes.js`, `route/RouteComparisonWorkspace.jsx` |
| Orphaned components removed: HazardDefencePanel, RouteComparisonPanel, RouteCompareOverlay, RouteUpgradeTools, UtilityDrawer, MarsMapInteractionLayer | — |
| Team NeuroNexus branding, copyright line, Meet the Team link | top bar, evidence bar, Command Index → Team |
| Mars Intelligence v2 (see below) | `science/ai/` |
| Docker Compose deployment and `DEPLOYMENT.md` | `deploy/`, `docker-compose.yml` |
| Tests: `tests/test_mission_console_v2.py` (pytest) and `frontend/src/__tests__` (vitest, including the registry-coverage test) | — |

### Mars Intelligence v2 (added scope)

- **Knowledge layer.** `science/ai/knowledge_base.py` is a dependency-free BM25 index. It covers curated notes in `science/ai/knowledge/*.md` (Mars science, missions, history and human exploration, the project and team), the project docs, and the UI command catalogue. It rebuilds automatically when a file changes. To extend the assistant, add a Markdown file to that folder.
- **New tools** (registered with `@tool` in `science/ai/knowledge_tools.py`):
  - `search_mars_knowledge`, `search_project_docs`, `get_ui_guide`;
  - `lookup_mars_place` (whole gazetteer), `get_landing_sites`;
  - `get_dust_scenario` (any sol or place), `get_terrain_statistics`;
  - `mars_calculator`: Ls, Mars Year and season for any date via Allison & McEwen 2000 / Mars24, plus unit conversions.
- **Answers and UI.** Answers return `sources` (cited knowledge sections) and per-tool timings. The chat UI adds a web-search toggle (Google Search grounding, with automatic fallback when a model rejects search plus tools), grouped suggestions, persistent history, copy, transcript export and Markdown tables.
- **Provider switch.** `science/ai/provider.py` selects the provider (`AI_PROVIDER`, default `gemini`). Adding a provider means implementing three functions; tools and knowledge are reused unchanged.
- **Scope.** NASA, the NASA Space Apps 2026 partner agencies and SpaceX. A test enforces it for the curated knowledge.

### Deviations from the plan

- **`RoutesContext`.** It was not introduced as a React context. Saved routes stay in `App` state, but all of their logic lives in `utils/savedRoutes.js`. Moving that state into a context is a mechanical follow-up.
- **`App.jsx` size.** The file is still about 3,600 lines (target: under 1,500). The new features live in their own modules; the remaining inline JSX (left column, route console) is the next extraction.
- **Dust map while playing.** It refreshes every 4th sol to limit requests. The τ chart and KPI update every sol.
