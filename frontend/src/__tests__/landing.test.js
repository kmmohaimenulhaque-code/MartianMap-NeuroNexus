/* Landing page and tutorials: data integrity, generated numbers, and the copy rules
   (American spelling, no emoji, no em dashes, no "safe" verdicts, no denylisted affiliations). */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FRONTEND = fileURLToPath(new URL("../..", import.meta.url));
const REPO = join(FRONTEND, "..");
const read = (p) => readFileSync(join(FRONTEND, p), "utf8");
const json = (p) => JSON.parse(read(p));

const spec = json("landing/data/tutorials.json");
const sizes = json("landing/data/media.json");
const headline = json("landing/data/headline.json");
const glossary = json("landing/data/glossary.json").terms;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(js|json|css|html)$/.test(name) ? [p] : [];
  });
const COPY_FILES = [join(FRONTEND, "index.html"), join(FRONTEND, "tutorials/index.html"), ...walk(join(FRONTEND, "landing"))];

describe("tutorials.json", () => {
  it("has twelve tutorials with unique ids", () => {
    const ids = spec.tutorials.map((t) => t.id);
    expect(ids.length).toBe(12);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every step uses known media, in-range focus and cursor, and a caption of at most 20 words", () => {
    for (const t of spec.tutorials) {
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(3);
      for (const s of t.steps) {
        expect(spec.media[s.media], `${t.id} media ${s.media}`).toBeTruthy();
        expect(sizes[s.media], `${t.id} size ${s.media}`).toHaveLength(2);
        const [x, y, w, h] = s.focus;
        expect(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001, `${t.id} focus`).toBe(true);
        if (s.cursor) expect(s.cursor.every((v) => v >= 0 && v <= 1), `${t.id} cursor`).toBe(true);
        expect(s.caption.split(/\s+/).length, s.caption).toBeLessThanOrEqual(20);
      }
      for (const g of t.glossary) expect(glossary[g], `${t.id} glossary ${g}`).toBeTruthy();
    }
  });

  it("every media file and its source screenshot exist", () => {
    for (const [key, m] of Object.entries(spec.media)) {
      expect(existsSync(join(REPO, m.src)), m.src).toBe(true);
      expect(existsSync(join(FRONTEND, "public/landing/media", `${key}.webp`)), key).toBe(true);
    }
    expect(existsSync(join(FRONTEND, "public/landing/media/hero-hirise.webp"))).toBe(true);
  });
});

describe("headline numbers are generated, never typed", () => {
  it("headline.json matches validation/reports/latest.json", () => {
    const latest = JSON.parse(readFileSync(join(REPO, "validation/reports/latest.json"), "utf8"));
    expect(headline.run_id).toBe(latest.run_id);
    for (const [site, entry] of Object.entries(latest.sites)) {
      const byLabel = Object.fromEntries(entry.headline.map((r) => [r.label, r]));
      expect(headline.sites[site].mola_ratio).toBeCloseTo(byLabel["MOLA-only p90 underestimate"].number, 2);
      expect(headline.sites[site].hirise_ratio).toBeCloseTo(byLabel["HiRISE @3 m p90 ratio (tilt / slope)"].number, 2);
    }
  });

  it("the landing markup has no hard-coded validation ratios", () => {
    const html = read("index.html");
    for (const n of ["1.79", "2.35", "0.99", "0.92"]) expect(html.includes(n), n).toBe(false);
  });
});

describe("copy rules", () => {
  const texts = COPY_FILES.map((p) => [p.replace(FRONTEND, ""), readFileSync(p, "utf8")]);

  it("no em dashes", () => {
    expect(texts.filter(([, t]) => t.includes("—")).map(([p]) => p)).toEqual([]);
  });

  it("no emoji", () => {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{25B6}\u{25C0}]|\u{FE0F}/u;
    expect(texts.filter(([, t]) => EMOJI.test(t)).map(([p]) => p)).toEqual([]);
  });

  it("American spelling", () => {
    const BRITISH = /\b(colou?rs?\b(?<!colors?)|colour\w*|behaviour\w*|modelled|modelling|centre\w*|metres?|analys(e|ed|ing)|organis(e|ed|ation)\w*|visualis\w*|synchronis\w*|categoris\w*|catalogue\w*|licence\w*|programme\w*|travell(ed|ing)|labell(ed|ing)|grey|favourite\w*|optimis(e|ed|ation)\w*|utilis\w*|recognis\w*|realis(e|ed)|minimis\w*|maximis\w*)\b/i;
    const hits = texts.flatMap(([p, t]) => (BRITISH.test(t.replace(/<q>[^<]*<\/q>/g, "")) ? [`${p}: ${t.match(BRITISH)[0]}`] : []));
    expect(hits).toEqual([]);
  });

  it("never calls terrain, routes or places safe", () => {
    const ALLOWED = [/safe and scientifically meaningful decisions/g, /never labels ground safe/g, /Nothing is ever called safe/g, /safe-(top|bottom|area)/g, /safety limits?/gi];
    const hits = texts.flatMap(([p, t]) => {
      let s = t;
      for (const a of ALLOWED) s = s.replace(a, "");
      return /\bsafe\b/i.test(s) ? [p] : [];
    });
    expect(hits).toEqual([]);
  });

  it("no denylisted affiliations", () => {
    const DENY = /\b(qwen|alibaba|aliyun|deepseek|baidu|ernie|tencent|hunyuan|bytedance|doubao|moonshot|kimi|zhipu|chatglm|minimax|internlm|sensetime|iflytek|yandex|gigachat|sber|kaspersky|roscosmos|cnsa|tianwen|zhurong|soviet|ussr|bootcdn|npmmirror|gitee)\b/i;
    const hits = texts.flatMap(([p, t]) => (DENY.test(t) ? [`${p}: ${t.match(DENY)[0]}`] : []));
    expect(hits).toEqual([]);
  });
});
