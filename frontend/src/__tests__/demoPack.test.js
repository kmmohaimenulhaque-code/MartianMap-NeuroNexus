import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/* The service worker and the recorder share frontend/public/demo-canon.js; keys must not depend on ordering. */
const sandbox = { TextEncoder, crypto: globalThis.crypto, URLSearchParams };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL("../../public/demo-canon.js", import.meta.url), "utf8"), sandbox);
const { requestKey, canonQuery } = sandbox.nnDemoCanon;

describe("static demo pack keys", () => {
  it("ignore query order and numeric spelling", async () => {
    expect(canonQuery("?b=2&a=1.50")).toBe("a=1.5&b=2");
    expect(await requestKey("get", "/api/conditions", "?sol=400&site=gale", "")).toBe(await requestKey("GET", "/api/conditions", "?site=gale&sol=400", ""));
  });

  it("hash JSON bodies with sorted keys, and distinguish different bodies", async () => {
    const a = await requestKey("POST", "/api/marswalk/plan", "", JSON.stringify({ site: "gale", targets: [{ lat: 1, lon: 2 }] }));
    const b = await requestKey("POST", "/api/marswalk/plan", "", JSON.stringify({ targets: [{ lon: 2, lat: 1 }], site: "gale" }));
    const c = await requestKey("POST", "/api/marswalk/plan", "", JSON.stringify({ site: "jezero", targets: [{ lat: 1, lon: 2 }] }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^POST \/api\/marswalk\/plan\? #[0-9a-f]{32}$/);
  });
});
