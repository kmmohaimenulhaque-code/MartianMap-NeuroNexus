/*
 * frontend/src/utils/routeObjectives.js
 *
 * Objective definitions shared by the AI route designer, the map candidate
 * layer and App.jsx. Kept out of the component file so React Fast Refresh
 * keeps working and so the weighting rule has exactly one implementation.
 */

export const CANDIDATE_COLOURS = ["#75e6ff", "#ff9f68", "#8cf0b1", "#c99bff", "#ffd166", "#ff8fa3", "#7ad7f0"];

export const OBJECTIVES = [
  ["eva", "EVA burden"],
  ["terrain", "Terrain burden"],
  ["science", "Science opportunity"],
  ["operational", "Operational burden"],
];

export const OBJECTIVE_PRESETS = {
  LOW_EVA: { eva: 100, terrain: 0, science: 0, operational: 0 },
  LOW_TERRAIN: { eva: 0, terrain: 100, science: 0, operational: 0 },
  SCIENCE_FIRST: { eva: 15, terrain: 20, science: 55, operational: 10 },
  BALANCED: { eva: 25, terrain: 25, science: 25, operational: 25 },
};

/*
 * Weights always total exactly 100: the slider the user moved keeps its value
 * and the remainder is redistributed over the others by largest remainder, so
 * the displayed weights are always the weights actually sent to the engine.
 */
export function rebalanceWeights(weights, changedKey, nextValue) {
  const keys = OBJECTIVES.map(([key]) => key);
  const value = Math.max(0, Math.min(100, Math.round(Number(nextValue) || 0)));
  const others = keys.filter((key) => key !== changedKey);
  const remaining = 100 - value;
  const currentTotal = others.reduce((sum, key) => sum + (Number(weights[key]) || 0), 0);
  const scaled = others.map((key) => (currentTotal > 0 ? ((Number(weights[key]) || 0) * remaining) / currentTotal : remaining / others.length));
  const floors = scaled.map((number) => Math.floor(number));
  let leftover = remaining - floors.reduce((sum, number) => sum + number, 0);

  const order = scaled.map((number, index) => [number - floors[index], index]).sort((a, b) => b[0] - a[0]);
  for (const [, index] of order) {
    if (leftover <= 0) {
      break;
    }
    floors[index] += 1;
    leftover -= 1;
  }

  const next = { [changedKey]: value };
  others.forEach((key, index) => {
    next[key] = floors[index];
  });
  return next;
}

export function matchPreset(weights) {
  const match = Object.entries(OBJECTIVE_PRESETS).find(([, preset]) => OBJECTIVES.every(([key]) => preset[key] === weights[key]));
  return match ? match[0] : "CUSTOM";
}
