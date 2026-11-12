/* The active MARSWALK plan and its conditions, readable outside the view (exports, radial wheel). */

let state = { plan: null, conditions: null, site: null };
const listeners = new Set();

export const planStore = {
  get: () => state,
  set: (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe: (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
