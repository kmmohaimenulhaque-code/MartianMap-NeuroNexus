# Baseline, 2026-10-20 (before the Marswalk work)

Recorded on `feature/mission-console-v2` at `ccdb3e5`, Python 3.13.16, Node 22.22.0, npm 10.9.4,
before any change from `docs/prompts/NEURONEXUS_MARSWALK_ONE_SHOT_PROMPT.txt`.

| Check | Command | Result |
| --- | --- | --- |
| Backend tests | `python -m pytest tests -q` | **99 passed**, 1 warning (numpy ABI notice) in 6.7 s |
| Frontend unit tests (vitest) | `npx vitest run src` | **10 passed** (2 files) |
| Frontend node:test | `node --test tests/*.test.js` | **45 passed** |
| Frontend lint | `npm run lint` | **6 errors, 2 warnings** (pre-existing, listed below) |
| Frontend build | `npm run build` | OK, one 595 kB JS chunk (warning: chunk > 500 kB) |
| MOLA terrain | `GET /terrain/window?latitude=-4.6&longitude=137.4` | 400: every `data/raw/mola/meg128/topography/*.img` is a 134-byte Git LFS pointer in a fresh clone |

## Pre-existing lint findings

Errors (fixed in WS0 with no behavior change: two unused symbols removed, four
`react-hooks/set-state-in-effect` sites annotated with a reason):

- `App.jsx` 1394 `comparisonRoutes` unused; 1560 setState in effect; 1782 `handleMapLocationSelect` unused
- `MarsBriefingPanel.jsx` 127, `MarsMap.jsx` 341, `RoverPhotosPanel.jsx` 48: setState in effect

Warnings (kept; the count must not go up):

- `Mars3DView.jsx` 499 and 887: `react-hooks/exhaustive-deps` on `selectedLocation`

## Raw tail of the build output

```
rendering chunks...
computing gzip size...
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-fari5x2p.css  110.86 kB │ gzip:  24.80 kB
dist/assets/index-BiicE81B.js   595.48 kB │ gzip: 179.68 kB

✓ built in 441ms
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```
