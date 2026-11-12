const MAP_COPY = "Apollo 14 made the cost of a short final push visible. The same decision pattern drives NeuroNexus: compare the ground model, the human limit and the evidence before committing to a route.";

export function initApolloStory(root = document) {
  const card = root.querySelector("[data-apollo-card]");
  if (!card) return;

  const image = card.querySelector("[data-apollo-image]");
  const copy = card.querySelector("[data-apollo-copy]");
  const views = [...card.querySelectorAll("[data-apollo-view]")];
  const pins = [...card.querySelectorAll("[data-apollo-pin]")];
  const originalCopy = copy?.textContent || "";

  image?.addEventListener("error", () => {
    image.src = "/landing/media/hero-hirise.webp";
    image.alt = "Fallback HiRISE terrain view used when the NASA image host is unavailable";
    card.classList.add("is-fallback");
  }, { once: true });

  if (image?.complete && image.naturalWidth === 0) image.dispatchEvent(new Event("error"));

  const selectView = (view) => {
    views.forEach((button) => {
      const active = button.dataset.apolloView === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (copy) copy.textContent = view === "map" ? MAP_COPY : originalCopy;
    card.classList.toggle("is-map-view", view === "map");
  };

  views.forEach((button) => button.addEventListener("click", () => selectView(button.dataset.apolloView)));
  pins.forEach((pin) => pin.addEventListener("click", () => {
    card.querySelectorAll(".lp-story__pin").forEach((item) => item.classList.remove("is-selected"));
    pin.classList.add("is-selected");
    if (copy) copy.textContent = pin.dataset.apolloPin === "crater"
      ? "Cone Crater was the science target. Its rim was close enough to see, but the remaining climb still had a mission cost."
      : "The approximate thirty-meter turnaround is the lesson: a small distance can represent a large change in terrain burden, time and evidence.";
  }));
}
