/* Core Features: one card per tutorial. A card's media tile plays its tutorial as a muted, looping preview while
   at least half of it is visible, and pauses off screen. On phones only one preview runs at a time (battery).
   Under reduced motion or Save-Data, cards show the first frame and play only when opened. */

import { TutorialStage } from "./stage.js";
import { escapeHtml } from "./content.js";
import { isPhone, reducedMotion, saveData } from "./env.js";

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l14 8-14 8z"/></svg>';
const ARROW = '<svg class="lp-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';

export function renderCards(list, spec, { sizes, tokens, openPlayer, consolePath }) {
  if (!list) return [];
  list.innerHTML = spec.tutorials
    .map(
      (t, i) => `
      <li class="lp-card" id="feature-${t.id}">
        <button class="lp-card__media" type="button" data-open="${t.id}" aria-label="Play tutorial: ${escapeHtml(t.title)}">
          <span class="lp-card__stage" data-stage="${t.id}"></span>
          <span class="lp-card__play">${PLAY_ICON}</span>
        </button>
        <p class="lp-card__tags"><span class="lp-num">${String(i + 1).padStart(2, "0")}</span> &nbsp; ${t.tags.map(escapeHtml).join(" &middot; ")}</p>
        <h3 class="lp-card__title">${ARROW}<span>${escapeHtml(t.title)}</span></h3>
        <p class="lp-card__summary">${escapeHtml(t.summary)}</p>
        <div class="lp-card__actions">
          <button type="button" data-open="${t.id}">Watch Tutorial</button>
          <a href="${consolePath}?tutorial=${encodeURIComponent(t.id)}">Try It in the Console ${ARROW}</a>
        </div>
      </li>`,
    )
    .join("");

  list.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openPlayer(b.dataset.open, b)));

  const stages = new Map();
  const ensure = (id) => {
    if (stages.has(id)) return stages.get(id);
    const t = spec.tutorials.find((x) => x.id === id);
    const host = list.querySelector(`[data-stage="${id}"]`);
    const st = new TutorialStage(host, t, { sizes, tokens, mode: "card" });
    st.go(0, { autoplay: false });
    stages.set(id, st);
    return st;
  };

  const still = reducedMotion() || saveData();
  if (!("IntersectionObserver" in window)) {
    spec.tutorials.forEach((t) => ensure(t.id));
    return stages;
  }
  const visible = new Map();
  const choose = () => {
    if (still) return;
    const entries = [...visible.entries()].filter(([, r]) => r >= 0.5);
    const allowed = isPhone() ? entries.sort((a, b) => b[1] - a[1]).slice(0, 1).map(([id]) => id) : entries.map(([id]) => id);
    stages.forEach((st, id) => {
      if (allowed.includes(id)) {
        if (!st.playing) st.play();
      } else if (st.playing) st.pause();
    });
  };
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        const id = e.target.dataset.stage;
        if (e.isIntersecting || e.intersectionRatio > 0) {
          ensure(id);
          visible.set(id, e.intersectionRatio);
        } else visible.delete(id);
      });
      choose();
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "200px 0px" },
  );
  list.querySelectorAll("[data-stage]").forEach((el) => io.observe(el));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stages.forEach((st) => st.pause());
    else choose();
  });
  return stages;
}
