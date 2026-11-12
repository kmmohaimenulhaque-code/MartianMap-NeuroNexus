/* NeuroNexus landing page entry. Plain modules, no framework: the page must paint fast on any phone.
   three.js loads later, only for the finale globe. */

import "./styles/landing.css";
import headline from "./data/headline.json";
import site from "./data/site.json";
import spec from "./data/tutorials.json";
import sizes from "./data/media.json";
import glossary from "./data/glossary.json";

import { captionTokens, fillLinks, fillNumbers, renderMarquee, renderTeam, renderTicker } from "./js/content.js";
import { initBrushes, initCounters, observeReveals, splitWords } from "./js/reveal.js";
import { initHeader, initMagnetic } from "./js/header.js";
import { initMenu, initStatus } from "./js/menu.js";
import { initTerms } from "./js/terms.js";
import { initLens } from "./js/lens.js";
import { renderCards } from "./js/features.js";
import { createPlayer } from "./js/player.js";
import { initFinale } from "./js/finale.js";

const doc = document;
doc.documentElement.classList.remove("no-js");

const tokens = captionTokens(headline);

fillLinks(doc, site);
fillNumbers(doc, headline);
renderTeam(doc.querySelector("[data-team]"), site.team);
renderMarquee(doc.querySelector("[data-marquee]"), "Play Reel");
renderTicker(doc.querySelector("[data-ticker]"), ["NASA MOLA", "MRO HiRISE", "MRO CTX", "Mars Odyssey THEMIS", "MSL RAD", "NASA Ames Mars GCM", "NASA MMGIS", "USGS SIM 3292", "IAU Gazetteer", "ESA Mars Express"]);
renderTicker(doc.querySelector("[data-continue]"), ["Continue to Scroll", "NeuroNexus", "NASA Space Apps 2026"]);
doc.querySelectorAll("[data-brush] path").forEach((p) => p.setAttribute("pathLength", "1"));

const player = createPlayer(doc.querySelector("[data-player]"), spec, { sizes, tokens, consolePath: site.consolePath });
renderCards(doc.querySelector("[data-cards]"), spec, { sizes, tokens, consolePath: site.consolePath, openPlayer: player.open });
doc.querySelector("[data-play-reel]")?.addEventListener("click", (e) => player.openReel(e.currentTarget));

splitWords(doc);
observeReveals(doc);
initBrushes(doc);
initCounters(doc, headline);
initHeader();
initMagnetic(doc);
initMenu();
initStatus();
initTerms(doc, glossary);
initLens(headline.hero);
initFinale();
