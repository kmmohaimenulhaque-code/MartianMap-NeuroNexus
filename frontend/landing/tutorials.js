/* /tutorials/ gallery: every tutorial card and the shared player. */

import "./styles/landing.css";
import headline from "./data/headline.json";
import site from "./data/site.json";
import spec from "./data/tutorials.json";
import sizes from "./data/media.json";

import { captionTokens } from "./js/content.js";
import { observeReveals, splitWords } from "./js/reveal.js";
import { initHeader, initMagnetic } from "./js/header.js";
import { renderCards } from "./js/features.js";
import { createPlayer } from "./js/player.js";

document.documentElement.classList.remove("no-js");
const tokens = captionTokens(headline);
const player = createPlayer(document.querySelector("[data-player]"), spec, { sizes, tokens, consolePath: site.consolePath });
renderCards(document.querySelector("[data-cards]"), spec, { sizes, tokens, consolePath: site.consolePath, openPlayer: player.open });
splitWords(document);
observeReveals(document);
initHeader();
initMagnetic(document);
