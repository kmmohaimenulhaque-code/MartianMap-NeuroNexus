/* Full-screen tutorial player: the stage, a step list you can jump through, play and pause, previous and next,
   keyboard (Left, Right, Space, Esc) and swipe, and TRY IT IN THE CONSOLE. "Reel" mode plays every tutorial in turn.
   Deep link: #play/<tutorial-id>. */

import { TutorialStage } from "./stage.js";
import { escapeHtml, fillTokens } from "./content.js";
import { haptic, reducedMotion } from "./env.js";

const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-8 7 8 7z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l8 7-8 7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
};

export function createPlayer(root, spec, { sizes, tokens, consolePath }) {
  let stage = null;
  let returnFocus = null;
  let reelIndex = -1;

  const close = () => {
    stage?.destroy();
    stage = null;
    reelIndex = -1;
    root.classList.remove("is-open");
    document.body.classList.remove("is-locked");
    setTimeout(() => {
      root.hidden = true;
      root.innerHTML = "";
    }, 300);
    if (location.hash.startsWith("#play/")) history.replaceState(null, "", location.pathname + location.search);
    returnFocus?.focus?.();
  };

  const syncPlayButton = () => {
    const b = root.querySelector("[data-pl-toggle]");
    if (!b || !stage) return;
    b.innerHTML = `${stage.playing ? ICON.pause : ICON.play}<span class="lp-sr">${stage.playing ? "Pause" : "Play"}</span>`;
    b.setAttribute("aria-label", stage.playing ? "Pause" : "Play");
  };

  const mount = (t, { reel = false } = {}) => {
    stage?.destroy();
    const first = sizes[t.steps[0].media] || [16, 10];
    const portrait = first[1] > first[0];
    root.innerHTML = `
      <div class="pl-shell">
        <div class="pl-top">
          <div>
            <p class="lp-eyebrow lp-eyebrow--dark">${reel ? `Reel &middot; ${reelIndex + 1} of ${spec.tutorials.length}` : "Tutorial"}</p>
            <h2 class="pl-title" id="lp-player-title">${escapeHtml(t.title)}</h2>
          </div>
          <button class="pl-btn" type="button" data-pl-close>Close</button>
        </div>
        <div class="pl-stage-wrap" style="--ar:${portrait ? "9 / 14" : "16 / 10"}" data-pl-stage></div>
        <div class="pl-side">
          <ol class="pl-steps">${t.steps
            .map(
              (s, i) =>
                `<li><button type="button" data-pl-step="${i}"><span class="lp-num">${String(i + 1).padStart(2, "0")}</span><span>${escapeHtml(fillTokens(s.caption, tokens))}</span></button></li>`,
            )
            .join("")}</ol>
          <div class="pl-controls">
            <button class="pl-btn" type="button" data-pl-prev aria-label="Previous step">${ICON.prev}</button>
            <button class="pl-btn" type="button" data-pl-toggle aria-label="Pause">${ICON.pause}</button>
            <button class="pl-btn" type="button" data-pl-next aria-label="Next step">${ICON.next}</button>
            <a class="pl-btn pl-btn--try" href="${consolePath}?tutorial=${encodeURIComponent(t.id)}">Try It in the Console</a>
          </div>
          <p class="pl-note">Built from real screenshots of the NeuroNexus console. Arrow keys step, Space pauses, Esc closes.</p>
        </div>
      </div>`;
    const host = root.querySelector("[data-pl-stage]");
    stage = new TutorialStage(host, t, {
      sizes,
      tokens,
      mode: "player",
      loop: false,
      onStep: (i) => {
        root.querySelectorAll("[data-pl-step]").forEach((b) => {
          if (Number(b.dataset.plStep) === i) b.setAttribute("aria-current", "step");
          else b.removeAttribute("aria-current");
        });
        syncPlayButton();
      },
      onEnd: () => {
        if (reel && reelIndex < spec.tutorials.length - 1) {
          reelIndex += 1;
          mount(spec.tutorials[reelIndex], { reel: true });
        } else syncPlayButton();
      },
    });
    stage.go(0, { autoplay: !reducedMotion() });
    syncPlayButton();

    root.querySelector("[data-pl-close]").addEventListener("click", close);
    root.querySelector("[data-pl-prev]").addEventListener("click", () => {
      stage.prev();
      haptic(6);
    });
    root.querySelector("[data-pl-next]").addEventListener("click", () => {
      stage.next();
      haptic(6);
    });
    root.querySelector("[data-pl-toggle]").addEventListener("click", () => {
      if (stage.playing) stage.pause();
      else stage.play();
      syncPlayButton();
    });
    root.querySelectorAll("[data-pl-step]").forEach((b) =>
      b.addEventListener("click", () => {
        stage.go(Number(b.dataset.plStep), { autoplay: stage.playing });
        haptic(6);
      }),
    );

    let x0 = null;
    host.addEventListener("pointerdown", (e) => {
      x0 = e.clientX;
    });
    host.addEventListener("pointerup", (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) dx < 0 ? stage.next() : stage.prev();
    });
  };

  const open = (id, from, { reel = false } = {}) => {
    const t = reel ? spec.tutorials[0] : spec.tutorials.find((x) => x.id === id);
    if (!t) return;
    returnFocus = from || document.activeElement;
    reelIndex = reel ? 0 : -1;
    root.hidden = false;
    document.body.classList.add("is-locked");
    mount(t, { reel });
    requestAnimationFrame(() => root.classList.add("is-open"));
    if (!reel) history.replaceState(null, "", `#play/${t.id}`);
    setTimeout(() => root.querySelector("[data-pl-close]")?.focus(), 50);
  };

  root.addEventListener("keydown", (e) => {
    if (!stage) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight") stage.next();
    else if (e.key === "ArrowLeft") stage.prev();
    else if (e.key === " " && !e.target.closest("button, a")) {
      e.preventDefault();
      if (stage.playing) stage.pause();
      else stage.play();
      syncPlayButton();
    } else if (e.key === "Tab") {
      const items = [...root.querySelectorAll('a[href], button:not([disabled])')];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  const fromHash = () => {
    const m = location.hash.match(/^#play\/([a-z0-9-]+)$/);
    if (m) open(m[1]);
  };
  fromHash();
  window.addEventListener("hashchange", fromHash);

  return { open, openReel: (from) => open(null, from, { reel: true }), close };
}
