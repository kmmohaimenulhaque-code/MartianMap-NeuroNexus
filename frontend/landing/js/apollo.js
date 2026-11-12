/* Apollo 14 story: reveals on scroll (fade, rise, and the image settling from scale 1.04 to 1), HUD pins that show on
   hover or focus and retell the story when chosen, and a fallback image if the NASA host is unreachable. */

import { reducedMotion } from "./env.js";

const PIN_COPY = {
  crater: "Cone Crater was the science target. Its rim was close enough to see, but the remaining climb still had a mission cost.",
  turnaround: "The approximate thirty-meter turnaround is the lesson: a small distance can represent a large change in terrain burden, time and evidence.",
};

export function initApolloStory(root = document) {
  const card = root.querySelector("[data-apollo-card]");
  if (!card) return;
  const image = card.querySelector("[data-apollo-image]");
  const copy = card.querySelector("[data-apollo-copy]");
  const original = copy?.textContent || "";

  image?.addEventListener(
    "error",
    () => {
      image.src = "/landing/media/hero-hirise.webp";
      image.alt = "Fallback HiRISE terrain view used when the NASA image host is unavailable";
      card.classList.add("is-fallback");
    },
    { once: true },
  );
  if (image?.complete && image.naturalWidth === 0) image.dispatchEvent(new Event("error"));

  card.querySelectorAll("[data-apollo-pin]").forEach((pin) => {
    pin.tabIndex = 0;
    pin.setAttribute("role", "button");
    const choose = () => {
      const on = !pin.classList.contains("is-selected");
      card.querySelectorAll("[data-apollo-pin]").forEach((p) => p.classList.remove("is-selected"));
      pin.classList.toggle("is-selected", on);
      if (copy) copy.textContent = on ? PIN_COPY[pin.dataset.apolloPin] : original;
    };
    pin.addEventListener("click", choose);
    pin.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    });
  });

  // Reveal once, then tie the image scale to scroll position while the story is on screen.
  new IntersectionObserver(
    ([e], io) => {
      if (!e.isIntersecting) return;
      card.classList.add("is-in");
      io.disconnect();
    },
    { threshold: 0.2 },
  ).observe(card);
  if (reducedMotion()) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const r = card.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.9)));
    card.style.setProperty("--story-p", p.toFixed(3));
  };
  addEventListener("scroll", () => (raf ||= requestAnimationFrame(update)), { passive: true });
  update();
}
