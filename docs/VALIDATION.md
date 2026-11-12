# Validation: rover ground truth (V1-V7)

Curiosity (Gale) and Perseverance (Jezero) are the only ground truth humanity has on Mars. The suite compares
the terrain ladder and the planner against their drives. Every number in the README "What's validated" table
and in the console's VALIDATION card is read from `validation/reports/latest.json`, which this suite writes.
Nothing is typed in by hand (enforced by `tests/test_readme_numbers.py`).

Run it: `python -m science.validation.run --site gale|jezero|all` (writes
`validation/reports/<site>/<run_id>/{report.json, report.md, figures/}` and `validation/reports/latest.json`).

## Rules

- Every metric reports n, a point estimate, a 95% bootstrap confidence interval (1,000 resamples, seed 2026)
  and a breakdown by terrain source (HiRISE, CTX, MOLA).
- Gale is the development site. Jezero runs the same code with no re-tuning: nothing is tuned on Jezero.
- Rover data: NASA MMGIS end-of-drive waypoints and traverses (`MMGIS_*` ledger ids), full resolution.
  `-9999` sentinels are missing values. The dated snapshot `data/snapshots/rovers/` is used when offline.
- Terrain: the same STAC products, datum checks and selector as the console (`science/hires`).

## Metrics

**V1 Elevation consistency.** Rover `elev_geoid` minus DTM elevation at each waypoint (bilinear), per family:
bias (mean), RMSE, NMAD = 1.4826 x median(|d - median(d)|).
Caveat: rover localization is registered to HiRISE base maps and the DTMs are tied to MOLA, so this is a
consistency check, not an independent accuracy check.

**V2 Independent vertical check.** MOLA altimetry shots (the `mola_csv` assets of 2023 CTX items: latitude,
longitude, radius) converted to height above the MOLA areoid, minus HiRISE and CTX DTM elevations at the shot.
Caveat: the CTX DTMs were aligned to MOLA with pc_align, so CTX-vs-shots is not independent; HiRISE-vs-shots is
the stronger check.

**V3 Slope scale-dependence (the headline).** Rover IMU tilt versus DTM slope at the waypoint at baselines of
1, 3, 5, 10, 20 and 100 m (HiRISE), 20 and 100 m (CTX) and 463 m (MOLA). Reported: Spearman rho, bias
(mean slope - tilt) and the p90 ratio (p90 of tilt / p90 of slope; above 1 means the map underestimates the
steep tail). Rover scale: Curiosity's wheelbase is about 1.9 m and both rovers are about 3 m long, so the
3 m baseline is the closest to the vehicle footprint.
Caveats: rocks under the wheels tilt the rover without being in the DTM; drivers park deliberately on gentle
ground and avoid hazards, so drivable ground is over-sampled.

**V4 Route plausibility.** Consecutive waypoint legs of 200-800 m (at most 40 per rover, evenly spaced, chosen
deterministically; the planner's fine pass runs at 2 m for these legs). Each leg is planned three ways: straight line, MOLA-only planner, full-ladder planner, and
compared with the real drive: discrete Frechet distance, Hausdorff distance, length ratio (plan / drive) and
the share of the plan within 10 m of the drive. All distances are computed in a local metric frame.
Caveats: rovers are not astronauts; drivers also weighed sand, wheel wear, science stops and communication
windows, none of which the planner sees.

**V5 Reproducibility.** Twenty fixed plans are run twice and must be byte-identical; the route engine's
replay (VERIFY) must reproduce its candidates.

**V6 Seams.** Elevation differences where HiRISE, CTX and MOLA overlap around the waypoints (HiRISE averaged
to the CTX posting first). Steps larger than 2 m are flagged; the console flags seam pixels on the map.

**V7 Radiation sanity (P1).** Whether the archived RAD dose rate is anticorrelated with surface pressure, as
published. If it does not reproduce, the report says so.

## What these results do not show

- Hazards below DTM resolution (rocks under 1-2 m, ripples, regolith strength).
- That a route is safe. Planning limits are not safety limits.
- Human walking performance on Mars: rovers drive, they do not walk.
