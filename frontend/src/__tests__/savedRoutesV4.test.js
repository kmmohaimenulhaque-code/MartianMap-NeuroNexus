import { describe, expect, it } from "vitest";

import { STORAGE_KEY_V3, STORAGE_KEY_V4, geometryHash, loadSavedRoutes } from "../utils/savedRoutes";

function memoryStorage(entries) {
  const map = new Map(Object.entries(entries));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}

const V3 = [{ id: "r1", name: "Gale leg", schema: 3, colourIndex: 2, points: [{ latitude_deg: -4.7, longitude_deg: 137.4 }, { latitude_deg: -4.6, longitude_deg: 137.5 }], evaluation: { status: "ok" }, generation: { request: { objective: "balanced" } } }];

describe("saved routes v3 -> v4", () => {
  it("adds reproducibility fields without losing any v3 data", () => {
    const [route] = loadSavedRoutes(memoryStorage({ [STORAGE_KEY_V3]: JSON.stringify(V3) }));
    expect(route).toMatchObject({ ...V3[0], schema: 4 });
    expect(route.resolution_ladder.mode).toBe("mola");
    expect(route.data_versions[0].ledger_id).toBe("MOLA_MEGDR");
    expect(route.source_ids).toEqual(["MOLA_MEGDR", "NN_ROUTE_ENGINE"]);
    expect(route.config_hash).toBeNull();
    expect(route.geometryHash).toBe(geometryHash(V3[0].points)); // VERIFY compares this hash
  });

  it("prefers v4 records and keeps their own provenance", () => {
    const v4 = [{ ...V3[0], schema: 4, resolution_ladder: { mode: "ladder", rungs: ["HIRISE"] }, config_hash: "abc", source_ids: ["HIRISE_STAC_DTM"] }];
    const [route] = loadSavedRoutes(memoryStorage({ [STORAGE_KEY_V4]: JSON.stringify(v4), [STORAGE_KEY_V3]: JSON.stringify([]) }));
    expect(route.resolution_ladder.mode).toBe("ladder");
    expect(route.config_hash).toBe("abc");
    expect(route.source_ids).toEqual(["HIRISE_STAC_DTM"]);
  });
});
