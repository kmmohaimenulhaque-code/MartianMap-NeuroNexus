# Final report: NeuroNexus Marswalk meter-scale work (Section 11)

Prompt: `docs/prompts/NEURONEXUS_MARSWALK_ONE_SHOT_PROMPT.txt` (v2), plus the v3 refinement brief (no emoji, dark-cyan
palette, Switzer type, one activeSol, universal exports, Radial Feature Wheel, Browser Optimization opt-in).
Branch: `feature/mission-console-v2` (the session harness's branch; the prompt's `feature/marswalk-hires` was not
used, R11). To resume: read this file, `HANDOFF.md` and `git log`.

## 1. What shipped, by workstream

| WS | Scope | Status | Notes |
| --- | --- | --- | --- |
| WS0 | Baseline, MOLA without LFS (PDS MEG128), CI, pins, hygiene | DONE | `docs/baseline-2026-10.md`; `tools/fetch_mola.py`; `.github/workflows/ci.yml` |
| WS1 | Terrain ladder HiRISE 1 m → CTX 20 m → MOLA 463 m (USGS STAC COGs) | DONE | `science/hires/*`; datum check vs MOLA; seams flagged |
| WS2 | Multi-baseline Horn slope, detrended roughness, walkability (A1–A5) | DONE | `science/hires/derivatives.py`, `layers.py` |
| WS3 | Planner + EVA model (Tobler/Naismith, gravity-scaled Pandolf proxy, PNR) | DONE | `science/marswalk/*`; deterministic `plan_id` |
| WS4 | Rover traverses (NASA MMGIS, snapshot fallback) | DONE | display lines now cached and warmed (15–20 s → 0.2 s) |
| WS5 | Validation V1–V7, Gale + Jezero (out of sample) | DONE | `validation/reports/latest.json`; V7 not reproduced (reported) |
| WS6 | Conditions: RAD RDR (archived, lag stated), REMS/MEDA outreach, MY34 dust, solar geometry | DONE | `GET /conditions?site=&sol=` follows the console sol |
| WS7 | MARSWALK UI, layers, legend, THEMIS heatmap, 3D, manual, Browser Optimization, App split | DONE | App.jsx 2,468 lines |
| WS8 | Canonical source ledger v3 + visible source tags everywhere | DONE | 75 entries, schema-validated, `/sources` API |
| WS9 | AI tools (P1) | PARTIAL | Mars Intelligence tools exist from v2; no new WS9 tools this round |
| WS10 | Exports, e2e, screenshots, docs, deploy | DONE except live backend | static demo Space (see 9); Docker/Gradio Spaces need PRO |
| v3 | No emoji, palette, Switzer, no truncation, activeSol, exports, Radial Feature Wheel, opt-in optimization | DONE | guard tests for emoji, palette parity, wheel, exports, sol sync |

## 2. Headline validation numbers (from `validation/reports/latest.json`)

| Site | Id | Value (95% CI, n) | What it means |
| --- | --- | --- | --- |
| Gale | V3 | ρ = 0.37 [0.32, 0.41], n = 1,386 | rover IMU tilt ranks with the 3 m HiRISE slope, moderately |
| Gale | V3 | p90 tilt / slope 0.99× [0.89, 1.07] | at 3 m the map reproduces the steep tail the rover felt |
| Gale | V3 | MOLA-only p90 underestimate 1.79× [1.70, 1.85] | 463 m terrain hides most of the steep tail |
| Gale | V1 | NMAD 4.8 m [4.4, 5.2] (bias −8.7 m) | rover vs HiRISE elevation agree (consistency check: localization uses HiRISE) |
| Gale | V4 | 45% [40, 54], 40 legs | median share of a planned leg within 10 m of the real drive (MOLA-only 41%) |
| Gale | V5 | 20/20 identical | same request + data versions → byte-identical plan |
| Gale | V6 | HiRISE − CTX mean bias 7.3 m [7.0, 7.7] (median 6.6 m) | rung seams are real; 92% of windows exceed the 2 m flag, so seams are drawn |
| Gale | V7 | ρ = 0.10 [−0.08, 0.27], n = 121 | RAD-vs-pressure anticorrelation NOT reproduced in this window; reported, not tuned |
| Jezero | V3 | ρ = 0.51 [0.42, 0.60], n = 321 | out of sample, no re-tuning: the slope signal holds |
| Jezero | V3 | p90 ratio 0.92× [0.77, 1.09]; MOLA-only 2.35× [1.77, 2.62] | same picture as Gale |
| Jezero | V1 | NMAD 6.7 m [5.7, 7.4] (bias −7.0 m) | consistency check |
| Jezero | V4 | 41% [30, 50], 40 legs | route plausibility out of sample (MOLA-only 27%) |
| Jezero | V6 | mean bias −18.4 m [−19.5, −17.3] (median −19.4 m) | larger CTX offset at Jezero; flagged |

Correction made this session: the V6 headline previously showed the median with the mean's CI. It now shows the
mean bias with its own CI, and `tests/test_readme_numbers.py` fails if any headline value lies outside its CI.

## 3. Ledger changes

The legacy `updated_source_ledger.json` (39 sources + 8 team outputs) became the canonical
`data/manifests/source_ledger.json` v3: 75 entries, JSON-schema validated, 18 legacy ids merged as aliases on 16
entries (e.g. `MOLA`, `nasa_mola` → `MOLA_MEGDR`; `NASA_RAD`, `nasa_rad` → `MSL_RAD_RDR`). Statuses: INGESTED 30,
CATALOGED NOT INGESTED 16 (CRISM, SHARAD, HRSC-class products untouched), QUERIED LIVE 14, REFERENCE ONLY 11,
QUERIED LIVE (OUTREACH) 2 (REMS, MEDA), INGESTED (ARCHIVED, LAG) 1 (RAD, lag 212 days), QUERIED LIVE (STALE) 1.
Evidence classes: NASA REFERENCE 34, OBSERVED 20, COMPUTED 11, DERIVED 7, MODELED 1, SIMULATED 1, AI INTERPRETATION 1.

## 4. Tests, CI, e2e, screenshots

| Suite | Baseline (`b35e2ea^`) | Now |
| --- | --- | --- |
| pytest | 99 passed | 195 passed (network tests deselected) |
| vitest | 10 | 60 |
| node:test | 45 | 48 |
| ESLint | 6 errors, 2 warnings | 0 errors, 2 warnings (pre-existing, Mars3DView) |
| Playwright e2e (`frontend/e2e/screenshots.mjs`) | none | 12 assertions, 0 page errors |

CI: green through `ffa5f4c` (last read). The GitHub MCP server did not connect in the final session, so CI on the
latest commits could not be read from here.

Screenshots (`assets/screenshots/v3/`, embedded in README): 01 console overview, 02 Radial Feature Wheel + sub-wheel,
03 THEMIS heatmap at the active sol, 04 categorized layers + legend, 05 MARSWALK at sol 100, 06 MARSWALK at the storm
sol, 07 Browser Optimization (opt-in), 08 Command Index exports.

## 5. Measured performance

`docs/PERFORMANCE.md`. Browser (OFF / ON): ready 8.2 / 8.6 s; global FPS 36.5 / 38.1; MARSWALK heap 126.8 / 99.9 MB.
Backend warm: traverse 0.015 s (was 15–20 s), conditions 0.003 s, places 1.26 s.

## 6. Data verification log

- MOLA MEGDR tiles download from PDS at 129,761,280 bytes each; `megr` label: OFFSET 3396000, SCALING_FACTOR 1, UNIT METER.
- USGS STAC, Gale bbox [137.0,−5.2,137.8,−4.3]: 16 HiRISE DTMs; 13 readable; HTTP 404 for DTEEC_040770_1755_039280_1755_A01,
  DTEEC_018788_1755_018287_1755_A01, DTEEC_008147_1750_007356_1750_H01.
- All 13 readable Gale HiRISE DTMs pass the datum check against MOLA (|median| 0.7 to 21.3 m, NMAD 3.7 to 58 m).
- 3,698 CTX DTM footprints contain Curiosity's area; 2,024 items' `qa_metrics` assets return 404 (QA uses the empirical MOLA check).
- STAC `next` links point at an API Gateway host; the client rewrites them to the allowlisted STAC host.
- HiRISE ortho and DTM share CRS and bounds within 2 m; registration within 1–2 px at 2 m.
- MSL RAD RDR: dose rate unit µGy/h verified in the SIS; latest archived sol 4843, lag 212 days on 2026-10-20.
- REMS (CAB/NASA) and MEDA lines are outreach feeds; MEDA was stale on 2026-10-20.
- MY34 calendar: MY34 sol 1 = 2017-03-23 = Curiosity mission sol 1,644 (±1, calendar conversion); Perseverance landed in MY36 (no MY34 position).
- Norcross et al., NASA/TP-2010-216125 (NTRS 20110003409) exists. NASA/TP-2009-214796 could not be found: not cited.
- Pandolf terrain factors (Soule & Goldman 1972): 1.0 blacktop, 1.1 dirt road, 1.2 light brush, 1.5 heavy brush, 1.8 bog, 2.1 loose sand.
- Solar declination: Allison & McEwen (2000), obliquity 25.19°; JS and Python implementations parity-tested.

## 7. Known limitations and open issues

- Screening model only. Planning limits are not safety limits; metabolic and consumables numbers are MODELED proxies.
- Dust is the NASA Ames MGCM MY34 scenario (a modeled year with the 2018 storm), not an observation or forecast.
- RAD is archived with a lag and measured only at Gale; Jezero shows Gale's rate as context. Routes are never colored by dose.
- Rover localization is tied to HiRISE (V1 is a consistency check); rovers avoided hazards, so drivable ground is over-sampled.
- Hazards below DTM resolution (rocks under 1–2 m, ripples, regolith strength) are not represented.
- V7 (RAD vs pressure) was not reproduced in the sampled window.
- The live Space is static: requests outside the recorded demo pack answer NOT_IN_DEMO_PACK. Full computation runs locally.
- Fontshare's CDN is CORS-blocked by this sandbox's proxy (works in normal browsers); the e2e scripts re-serve the bytes.

## 8. Decisions needed from the team (Appendix E)

- Hosting: pay for a Hugging Face PRO (or any Docker host) to run the live backend, or keep the static demo.
- Whether to keep the THEMIS heatmap's honest empty columns (no interpolation) or add a seasonal model (would be MODELED).
- Seam handling at Jezero (CTX ≈ 18 m below HiRISE): re-align CTX to HiRISE per window, or keep flagging only.
- Default EVA parameters (pace, review/limit slopes, reserve) for the judged demo.

## 9. Live demo and exact commands

Live static demo: https://mhaquehaque-neuronexus-marswalk.static.hf.space (Space page: https://huggingface.co/spaces/Mhaquehaque/neuronexus-marswalk). 3,394 real recorded responses, bannered as not live.


```bash
python -m pip install -r requirements.txt
python tools/fetch_mola.py --sites gale jezero            # MOLA MEG128 tiles from PDS
cd frontend && npm ci && npm run build && cd ..
python -m uvicorn science.serve:app --host 0.0.0.0 --port 7860   # console + API on http://localhost:7860
python -m pytest -q && (cd frontend && npm run lint && npm test)
node frontend/e2e/screenshots.mjs                         # e2e + v3 screenshots (needs the server)
python -m science.validation.run --site all && python tools/update_readme_validation.py
node tools/record_demo_pack.mjs && python tools/deploy_static_space.py --space Mhaquehaque/neuronexus-marswalk
```
