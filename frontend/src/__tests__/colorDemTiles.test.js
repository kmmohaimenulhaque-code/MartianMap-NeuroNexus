import { describe, expect, it } from "vitest";
import { colorDemTiles } from "../components/mars/colorDemTiles";

describe("colorDemTiles", () => {
  it("covers a Gale route with level-7 tiles whose bounds contain it", () => {
    const route = [[-5.37, 137.81], [-5.04, 138.2]];
    const tiles = colorDemTiles(route);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.url.includes("/MColorDEM/MapServer/tile/7/"))).toBe(true);
    expect(tiles.some((t) => t.url.endsWith("/7/67/226"))).toBe(true); // -5.37, 137.81 verified live (HTTP 200)
    for (const [lat, lon] of route)
      expect(tiles.some(({ bounds: [[s, w], [n, e]] }) => lat >= s && lat <= n && lon >= w && lon <= e)).toBe(true);
  });

  it("drops to a coarser level for long routes and maps 0-360 east longitudes onto the -180 origin", () => {
    const tiles = colorDemTiles([[18.4, 77.4], [-5.4, 137.8]]);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(16);
    expect(tiles[0].url).not.toContain("/tile/7/");
    expect(colorDemTiles([[0, 359.9], [0, 0.1]])).toEqual([]); // seam: global basemap only
    expect(colorDemTiles([])).toEqual([]);
  });
});
