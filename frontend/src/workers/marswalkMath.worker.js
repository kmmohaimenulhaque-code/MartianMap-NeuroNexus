/*
 * Zero-copy Marswalk math worker (Browser Optimization). Display grids arrive once as transferred
 * buffers and stay here; each drag sends only the polyline. Same module as the main-thread fallback,
 * so the numbers are identical.
 */
import { evaluateProfile, lttb, trackFromGrids } from "../marswalk/marswalkMath";

const gridSets = new Map();

self.onmessage = (event) => {
  const { id, op, payload } = event.data;
  try {
    let result;
    let transfer = [];
    if (op === "grids") {
      gridSets.set(payload.key, payload.grids);
      result = { stored: payload.key };
    } else if (op === "evaluate") {
      result = evaluateProfile(payload.ds, payload.dz, payload.rough, payload.v);
    } else if (op === "track") {
      const grids = gridSets.get(payload.gridsKey);
      if (!grids) throw new Error(`grid set ${payload.gridsKey} not loaded`);
      const track = trackFromGrids(payload.localPts, grids, payload.step);
      result = { ...evaluateProfile(track.ds, track.dz, track.rough, payload.v), pts: track.pts };
    } else if (op === "lttb") {
      result = Uint32Array.from(lttb(payload.xs, payload.ys, payload.threshold));
      transfer = [result.buffer];
    } else {
      throw new Error(`unknown op ${op}`);
    }
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error) });
  }
};
