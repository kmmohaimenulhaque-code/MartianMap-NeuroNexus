/* Header: hides while scrolling down, returns on scroll up, and switches to light ink over the dark finale. */

export function initHeader() {
  const header = document.querySelector("[data-header]");
  if (!header) return;
  const darkZones = [...document.querySelectorAll(".lp-finale, .lp-footer")];
  let lastY = window.scrollY;
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = window.scrollY;
    const goingDown = y > lastY + 4;
    const goingUp = y < lastY - 4;
    if (goingDown && y > 160 && !document.body.classList.contains("is-locked")) header.classList.add("is-hidden");
    if (goingUp || y < 80) header.classList.remove("is-hidden");
    lastY = y;
    const probe = 32;
    const dark = darkZones.some((z) => {
      const r = z.getBoundingClientRect();
      return r.top <= probe && r.bottom >= probe;
    });
    header.classList.toggle("is-dark", dark);
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  header.addEventListener("focusin", () => header.classList.remove("is-hidden"));
  update();
}

/* Magnetic pull on primary buttons for mouse and trackpad users only. */
export function initMagnetic(root = document) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll(".lp-magnetic").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * 0.18;
      const y = (e.clientY - (r.top + r.height / 2)) * 0.28;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
    el.addEventListener("pointerleave", () => {
      el.style.transform = "";
    });
  });
}
