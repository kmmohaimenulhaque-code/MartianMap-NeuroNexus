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
import { initGlass, initIntro } from "./js/hero.js";
import { initFx } from "./js/fx.js";
import { initApolloStory } from "./js/apollo.js";
import { initPareto } from "./js/pareto.js";

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
initApolloStory(doc);
initPareto(doc);
doc.querySelector("[data-play-reel]")?.addEventListener("click", (e) => player.openReel(e.currentTarget));

initIntro();
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
initGlass();
initFx(doc);

const innovation = doc.querySelector("[data-innovation]");
if (innovation) {
  const evidence = innovation.querySelector("[data-innovation-evidence]");
  const evidenceByTab = {
    gale: "463 m MOLA underestimates p90 steep ground by <strong>1.79x [1.70, 1.85]</strong>. A 1 m HiRISE surface at a 3 m rover baseline reproduces felt tilt at <strong>0.99x [0.89, 1.07]</strong>.",
    jezero: "Out-of-sample Jezero shows a <strong>2.35x [1.77, 2.62]</strong> MOLA p90 underestimate. HiRISE reproduces rover-scale tilt at <strong>0.92x</strong> with no retuning.",
    corridor: "The multi-resolution corridor stayed within 10 m of JPL's human-planned drive <strong>45% [40.00, 54.00]</strong> versus <strong>41%</strong> on MOLA-only, using a 1,627 m corridor path versus a 1,351 m straight line.",
  };
  innovation.querySelectorAll("[data-innovation-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      innovation.querySelectorAll("[data-innovation-tab]").forEach((item) => item.classList.toggle("is-active", item === button));
      evidence.innerHTML = evidenceByTab[button.dataset.innovationTab];
    });
  });
  const ribbon = innovation.querySelector("[data-sol-ribbon]");
  const updateSol = () => {
    const sol = Number(ribbon.value);
    const storm = sol >= 370 && sol <= 468;
    innovation.querySelector("[data-sol-number]").textContent = sol;
    innovation.querySelector("[data-sol-tau]").textContent = `tau ${storm ? "4.62" : sol < 370 ? "0.31" : "1.18"}`;
    innovation.querySelector("[data-sol-status]").textContent = storm ? "EXCEEDS PLANNING LIMIT" : "REVIEW REQUIRED";
    innovation.querySelector("[data-sol-status]").className = storm ? "is-exceeds" : "is-review";
    innovation.querySelector("[data-sol-track]").style.setProperty("--sol", `${(sol / 668) * 100}%`);
  };
  ribbon?.addEventListener("input", updateSol);
  updateSol();
  innovation.querySelectorAll("[data-warning]").forEach((button) => button.addEventListener("click", () => {
    evidence.textContent = `${button.dataset.warning}. Open the console warning card to inspect the source and uncertainty.`;
  }));
}
doc.querySelectorAll(".lp-impact-more").forEach((button) => button.addEventListener("click", () => {
  const card = button.closest("article");
  card.classList.toggle("is-expanded");
  button.textContent = card.classList.contains("is-expanded") ? "−" : "+";
}));
