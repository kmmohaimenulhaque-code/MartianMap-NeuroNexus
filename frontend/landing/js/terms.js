/* Glossary terms: a dotted-underline button that explains itself on hover (mouse), focus (keyboard) or tap (touch).
   WCAG 1.4.13: the card stays while hovered, Esc dismisses it, and only one card is open at a time. */

import { escapeHtml } from "./content.js";
import { finePointer } from "./env.js";

export function initTerms(root, glossary) {
  const card = document.querySelector("[data-termcard]");
  if (!card) return;
  let current = null;
  let hideTimer = 0;
  let showTimer = 0;

  const place = (btn) => {
    const r = btn.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
    let top = r.bottom + 10;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 10);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  const show = (btn) => {
    const entry = glossary.terms[btn.dataset.term];
    if (!entry) return;
    clearTimeout(hideTimer);
    current?.setAttribute("aria-expanded", "false");
    current = btn;
    btn.setAttribute("aria-expanded", "true");
    card.innerHTML = `<strong>${escapeHtml(entry.term)}</strong>${escapeHtml(entry.short)}`;
    card.hidden = false;
    place(btn);
    requestAnimationFrame(() => card.classList.add("is-open"));
  };
  const hide = () => {
    clearTimeout(showTimer);
    card.classList.remove("is-open");
    current?.setAttribute("aria-expanded", "false");
    current = null;
    hideTimer = setTimeout(() => {
      if (!current) card.hidden = true;
    }, 220);
  };

  root.querySelectorAll("[data-term]").forEach((btn) => {
    const entry = glossary.terms[btn.dataset.term];
    if (!entry) return;
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-describedby", "lp-termcard");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (current === btn) hide();
      else show(btn);
    });
    btn.addEventListener("focus", () => show(btn));
    btn.addEventListener("blur", () => {
      hideTimer = setTimeout(hide, 120);
    });
    if (finePointer()) {
      btn.addEventListener("pointerenter", () => {
        clearTimeout(hideTimer);
        showTimer = setTimeout(() => show(btn), 250);
      });
      btn.addEventListener("pointerleave", () => {
        clearTimeout(showTimer);
        hideTimer = setTimeout(hide, 180);
      });
    }
  });
  card.id = "lp-termcard";
  card.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  card.addEventListener("pointerleave", () => {
    hideTimer = setTimeout(hide, 180);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) hide();
  });
  document.addEventListener("click", (e) => {
    if (current && !card.contains(e.target)) hide();
  });
  window.addEventListener("scroll", () => current && place(current), { passive: true });
}
