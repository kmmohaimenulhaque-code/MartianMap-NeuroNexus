/* Full-screen menu: staggered links, focus trap, Esc to close, focus returns to the menu button.
   It also wakes the science servers once per visit, so the console is warm by the time a judge enters it. */

import { haptic } from "./env.js";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function initMenu() {
  const menu = document.querySelector("[data-menu]");
  const openBtn = document.querySelector("[data-menu-open]");
  if (!menu || !openBtn) return;
  const panel = menu.querySelector(".lp-menu__panel");
  [...menu.querySelectorAll(".lp-menu__primary a, .lp-menu__secondary a")].forEach((a, i) => a.style.setProperty("--i", String(i)));

  const open = () => {
    menu.hidden = false;
    document.body.classList.add("is-locked");
    openBtn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => menu.classList.add("is-open"));
    haptic(8);
    setTimeout(() => menu.querySelector("[data-menu-close]")?.focus(), 60);
  };
  const close = (returnFocus = true) => {
    menu.classList.remove("is-open");
    openBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("is-locked");
    setTimeout(() => {
      menu.hidden = true;
    }, 320);
    if (returnFocus) openBtn.focus();
  };

  openBtn.addEventListener("click", open);
  menu.querySelector("[data-menu-close]")?.addEventListener("click", () => close());
  menu.querySelectorAll("[data-menu-close-link]").forEach((a) => a.addEventListener("click", () => close(false)));
  menu.addEventListener("click", (e) => {
    if (!panel.contains(e.target)) close();
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...menu.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

/* GET /api/health once per session. Cold free-tier servers can take 30 to 60 s to wake. */
export function initStatus() {
  const dot = document.querySelector("[data-status-dot]");
  const text = document.querySelector("[data-status-text]");
  const set = (state, msg) => {
    if (dot) dot.className = `lp-live${state ? ` is-${state}` : ""}`;
    if (text) text.textContent = msg;
  };
  let done = false;
  const probe = async (attempt) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch("/api/health", { signal: ctrl.signal, cache: "no-store" });
      const body = r.ok ? await r.json().catch(() => null) : null;
      if (body && body.status === "ok") {
        done = true;
        set("online", "Science servers: online");
        return;
      }
      throw new Error("not ready");
    } catch {
      if (attempt < 6) {
        set("waking", "Science servers: waking up, about 30 to 60 seconds");
        setTimeout(() => probe(attempt + 1), 10000);
      } else if (!done) {
        set("", "Science servers: unreachable. The offline demo still works.");
      }
    } finally {
      clearTimeout(timer);
    }
  };
  const start = () => probe(0);
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 1200);
}
