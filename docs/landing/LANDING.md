# Landing page, tutorials and the /console/ move

The site now has three pages, built by one Vite config (`frontend/vite.config.js`):

| URL | Entry | What it is |
|---|---|---|
| `/` | `frontend/index.html` + `frontend/landing/main.js` | Landing page: hero resolution lens, statements, feature reel, 12 animated tutorials, proof, challenge trace, data, team, Mars globe finale |
| `/console/` | `frontend/console/index.html` + `frontend/src/main.jsx` | The mission console, unchanged apart from the label fixes below |
| `/tutorials/` | `frontend/tutorials/index.html` + `frontend/landing/tutorials.js` | Gallery of every tutorial with the shared player |

Old links keep working: an inline script in `frontend/index.html` sends any query string (except `utm_*`) or console
hash (such as `#mw=...` plan links) to `/console/` before the page paints. `science/serve.py` (`fallback_page`) and
`tools/gen_vercel_rewrites.py` send unknown paths under `/console/` and `/tutorials/` to their own page.

## Files

```
frontend/
  index.html                    landing page markup (static, readable without JavaScript)
  console/index.html            console entry (moved from frontend/index.html)
  tutorials/index.html          tutorial gallery
  vite.config.js                three entries
  landing/
    main.js                     landing entry
    tutorials.js                gallery entry
    styles/landing.css          all landing styles (tokens, layout, motion, reduced motion)
    data/tutorials.json         the 12 tutorials: steps, focus regions, cursor taps, captions
    data/glossary.json          landing glossary terms (hover, focus or tap)
    data/site.json              links, challenge title, team list
    data/headline.json          GENERATED: validation numbers from validation/reports/latest.json
    data/media.json             GENERATED: pixel size of every tutorial image
    js/stage.js                 tutorial engine: camera, spotlight, cursor, ripple, captions, progress
    js/player.js                full-screen player (keyboard, swipe, reel mode, #play/<id> deep link)
    js/features.js              feature cards with in-view looping previews
    js/lens.js                  hero resolution lens (canvas)
    js/finale.js                Mars globe (three.js, lazy loaded)
    js/menu.js                  menu overlay and science-server warm-up ping
    js/terms.js                 glossary tooltips
    js/header.js, reveal.js, content.js, env.js
  public/landing/media/*.webp   GENERATED from assets/screenshots
  e2e/landing.mjs               13 device classes: overflow, lens, menu, player, redirects, gallery
  src/__tests__/landing.test.js data integrity, generated numbers, copy rules, affiliation denylist
tools/build_landing_media.py    builds the media and the generated JSON (--check for CI)
```

## Commands

```bash
python tools/build_landing_media.py            # after screenshots change
python tools/build_landing_media.py --check    # CI: fails if headline.json or media.json is stale
cd frontend && npm test && npm run build
npx vite preview --port 4173 &
PLAYWRIGHT_MODULE=$(node -e "console.log(require.resolve('playwright'))") node e2e/landing.mjs
SHOTS=1 ... node e2e/landing.mjs               # also writes assets/screenshots/landing/
```

## Tutorials are real screenshots

Each tutorial is a list of steps over the README screenshots: the camera eases to a focus region, a spotlight frames
it, a cursor travels to a control and taps it, and a caption explains the step. Captions can use `{GALE_MOLA}`,
`{GALE_HIRISE}`, `{JEZERO_MOLA}` and `{JEZERO_HIRISE}`, filled from the generated validation numbers.

The screenshots predate the label fixes, so some still show "AI ROUTE DESIGN" in the console header. To refresh:

1. Start the console on :7860 and run `node frontend/e2e/screenshots.mjs` (and the device script for the phone shots).
2. `python tools/build_landing_media.py`.
3. If a control moved, adjust its `focus` or `cursor` numbers in `data/tutorials.json` (fractions of the image).

## Hero resolution lens

The hero image is the console's own MARSWALK render of the Gale demo walk on HiRISE 1 m terrain. Outside the lens
the page averages it to MOLA's 463 m pixel size (scale taken from the planner's "straight line 1200 m" reading,
about 97 screenshot pixels per MOLA pixel) and smooths it back up. This is a visualization of resolution, not a
second dataset, and the caption says so.

## Label fixes in the console (visible text only)

Ids, storage keys, command ids, CSS classes and API paths are unchanged.

| Was | Now |
|---|---|
| AI ROUTE DESIGN (top bar, 2D map, 3D toolbar, route sheet, wheel) | ROUTE DESIGN |
| AI Route Designer, Save AI route candidates (Command Index) | Route Designer, Save route candidates |
| AI candidate(s), AI route candidates, AI candidate routes (layers, legend, notices, assistant suggestion) | route candidate(s) |
| AI route N (default saved name) | Designed route N |
| MARTIAN MAP / MISSION CONTROL | MARTIAN MAP / MISSION CONSOLE |
| evidence_available (Interpretation panel) | Evidence available |

Not changed yet: "Safe Haven" (also used by the backend, AI tools and exports; rename everywhere at once), and the
backend's own AI router wording.

## Rules the landing page follows

- American spelling, no emoji, no em dashes, never "safe" as a verdict, no denylisted affiliations (tested).
- Validation numbers are generated, never typed (tested).
- Pinch zoom stays enabled. No scroll hijacking. Everything animates transform or opacity only.
- `prefers-reduced-motion`: no drift, no autoplay, instant reveals. Save-Data: no autoplay, no 3D globe.
- Mouse: hover effects, magnetic buttons, card tilt. Touch: pressed states, drag the lens, swipe the player.
  Android: short haptic ticks. iOS has no web vibration.
- Initial landing JavaScript is about 17 KB gzipped; three.js loads only near the finale.
