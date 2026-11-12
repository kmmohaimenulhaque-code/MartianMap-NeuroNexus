const DETAILS = [
  { title: "Low distance", status: "Dominated in this set", summary: "The shortest line is the trap in this set. It saves only 0.03% versus the low-EVA route while adding 8,735 m of climb.", values: [94, 100, 92, 54], metrics: ["1,464.7 km", "31,332 m", "630.1 h", "94.3"] },
  { title: "Low EVA", status: "Pareto / non-dominated", summary: "An extra 480 m buys 6.37 hours less estimated EVA time and 8,735 m less climb.", values: [94, 72, 91, 52], metrics: ["1,465.2 km", "22,597 m", "623.7 h", "93.1"] },
  { title: "Low terrain-risk proxy", status: "Pareto / non-dominated", summary: "This candidate spends distance to reduce the risk proxy from 94.3 to 79.5.", values: [97, 68, 94, 18], metrics: ["1,510.3 km", "21,416 m", "639.8 h", "79.5"] },
  { title: "Low terrain burden", status: "Pareto / non-dominated", summary: "The lowest cumulative climb and terrain burden come with the longest estimated EVA time.", values: [100, 64, 100, 27], metrics: ["1,620.6 km", "20,099 m", "681.7 h", "82.1"] },
  { title: "Science first", status: "Pareto / non-dominated", summary: "Science weighting keeps the route near cataloged USGS, IAU and THEMIS evidence while preserving a non-dominated trade-off.", values: [95, 73, 92, 36], metrics: ["1,471.8 km", "22,815 m", "626.7 h", "85.9"] },
  { title: "Balanced", status: "Pareto / non-dominated", summary: "Equal weights across EVA, terrain, science and operations produce a stable middle trade-off.", values: [95, 72, 92, 36], metrics: ["1,474.4 km", "22,652 m", "627.6 h", "85.9"] },
];

export function initPareto(root = document) {
  const section = root.querySelector("[data-pareto-detail]");
  const rows = [...root.querySelectorAll("[data-pareto-row]")];
  const filters = [...root.querySelectorAll("[data-pareto-filter]")];
  if (!section || !rows.length) return;
  // Status cells become pills: coral for the dominated route, cyan for the non-dominated frontier.
  rows.forEach((row) => {
    const cell = row.cells[1];
    const dominated = row.dataset.paretoStatus === "dominated";
    cell.innerHTML = `<span class="lp-status lp-status--${dominated ? "dominated" : "pareto"}">${cell.textContent.trim()}</span>`;
  });

  const select = (index) => {
    rows.forEach((row) => {
      const active = Number(row.dataset.paretoRow) === index;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
    });
    const item = DETAILS[index];
    section.dataset.status = index === 0 ? "dominated" : "pareto";
    section.innerHTML = `<div><span class="lp-eyebrow"><span class="lp-dot" aria-hidden="true"></span>Selected candidate</span><h3>${item.title}</h3><p>${item.status}. ${item.summary} The <button class="lp-term" type="button" data-term="edge-cost-model">edge cost model</button> keeps the trade-off deterministic.</p></div><div class="lp-pareto-bars">${item.values.map((value, i) => `<span><small>${["Distance", "Climb", "EVA time", "Risk proxy"][i]}</small><i><b style="width:${value}%"></b></i><em>${item.metrics?.[i] || ""}</em></span>`).join("")}</div>`;
    section.dispatchEvent(new CustomEvent("nn:terms-refresh", { bubbles: true }));
  };

  const filter = (value) => {
    rows.forEach((row) => {
      row.hidden = value !== "all" && row.dataset.paretoStatus !== value;
    });
    filters.forEach((button) => button.classList.toggle("is-active", button.dataset.paretoFilter === value));
    const first = rows.find((row) => !row.hidden);
    if (first) select(Number(first.dataset.paretoRow));
  };

  rows.forEach((row) => {
    row.addEventListener("click", () => select(Number(row.dataset.paretoRow)));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(Number(row.dataset.paretoRow));
      }
    });
  });
  filters.forEach((button) => button.addEventListener("click", () => filter(button.dataset.paretoFilter)));
  select(0);
}
