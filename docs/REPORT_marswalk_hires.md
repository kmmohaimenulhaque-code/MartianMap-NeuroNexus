# Marswalk meter-scale work: status report

Prompt: `docs/prompts/NEURONEXUS_MARSWALK_ONE_SHOT_PROMPT.txt` (v2). Updated at every phase gate so a new
session can resume: read this file and `git log`, then continue from the first phase whose gate is not met.

Branch note: the session harness assigns `feature/mission-console-v2` as the development branch, so the work
lives there instead of the prompt's `feature/marswalk-hires` (R11). Nothing is merged anywhere else.

## Phase status

| Phase | Scope | Status | Gate evidence |
| --- | --- | --- | --- |
| A | WS0 baseline, MOLA without LFS, CI, pins, hygiene | DONE | `docs/baseline-2026-10.md`; CI green on b35e2ea and d37b567; Gale/Jezero MOLA fetched from PDS |
| B | WS1 ladder, WS2 derivatives, WS8 T8.1-T8.3 ledger | DONE | Gale 1 m window: 1200x1200 px, 100% HiRISE, 3 m baseline exact; ledger v3 validates, legacy file regenerated with only the CTX/HiRISE status change |
| C | WS3 planner + EVA model, WS4 rover ingest | NEXT | |
| D | WS7 UI (Marswalk mode, layers, legend, heatmap, 3D, manual, tags), WS8 T8.4-T8.6 | TODO | |
| E | WS5 validation V1-V6 | TODO | |
| F | WS7 T7.7 Browser Optimization | TODO | |
| G | P1: WS6 conditions, replay, WS9, Docker, V7 | TODO | |
| H | Production readiness, docs, screenshots, deploy, final report | TODO | |

## Facts verified in this session (data verification log, continued in the final report)

- MOLA MEGDR tiles download from PDS at 129,761,280 bytes each; `megr` label: OFFSET 3396000, SCALING_FACTOR 1, UNIT METER.
- USGS STAC, Gale bbox [137.0,-5.2,137.8,-4.3]: 16 HiRISE DTMs; 13 readable; HTTP 404 for DTEEC_040770_1755_039280_1755_A01,
  DTEEC_018788_1755_018287_1755_A01, DTEEC_008147_1750_007356_1750_H01 (matches the prompt).
- All 13 readable Gale HiRISE DTMs pass the datum check against MOLA (|median| 0.7 to 21.3 m, NMAD 3.7 to 58 m).
- 3,698 CTX DTM footprints contain Curiosity's area; 2024 items' `qa_metrics` assets return 404 (QA uses the empirical MOLA check).
- STAC `next` links point at an API Gateway host; the client rewrites them to the allowlisted STAC host.
- HiRISE ortho and DTM share CRS and bounds within 2 m; ortho-to-hillshade registration is within 1-2 px at 2 m.
- Norcross et al., "Metabolic Costs and Biomechanics of Inclined Ambulation and Exploration Tasks in a Planetary Suit",
  NASA/TP-2010-216125 (NTRS 20110003409) exists. NASA/TP-2009-214796 could not be found on NTRS: not cited.
- Pandolf terrain factors (Soule & Goldman 1972): 1.0 blacktop, 1.1 dirt road, 1.2 light brush, 1.5 heavy brush,
  1.8 swampy bog, 2.1 loose sand.

## Deployment

Hugging Face Docker Spaces now need a PRO plan (HTTP 402 on create), so the live link will be a free static
Space that serves the built console plus a Service Worker replaying pre-recorded real API responses (demo pack),
with a visible banner. `deploy/space/Dockerfile` remains ready for any Docker host or a PRO Space.
