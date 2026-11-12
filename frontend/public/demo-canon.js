/*
 * Static demo pack: one canonical key per API request, shared verbatim by the service worker
 * (importScripts) and the recorder (tools/record_demo_pack.mjs, via vm). Query parameters are
 * sorted and numeric values normalized; JSON bodies are re-serialized with sorted keys and hashed.
 */
(function (root) {
  function canonJson(value) {
    if (Array.isArray(value)) return "[" + value.map(canonJson).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ":" + canonJson(value[k]); }).join(",") + "}";
    }
    return JSON.stringify(value);
  }
  function canonBody(text) {
    try {
      return canonJson(JSON.parse(text));
    } catch (e) {
      return text;
    }
  }
  async function sha256(text) {
    var bytes = new TextEncoder().encode(text);
    var digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function canonQuery(search) {
    var params = new URLSearchParams(search);
    var pairs = [];
    params.forEach(function (v, k) {
      var n = /^-?\d+(\.\d+)?$/.test(v) ? String(Number(v)) : v;
      pairs.push([k, n]);
    });
    pairs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    return pairs.map(function (p) { return encodeURIComponent(p[0]) + "=" + encodeURIComponent(p[1]); }).join("&");
  }
  async function requestKey(method, pathname, search, bodyText) {
    var key = method.toUpperCase() + " " + pathname + "?" + canonQuery(search);
    if (bodyText) key += " #" + (await sha256(canonBody(bodyText))).slice(0, 32);
    return key;
  }
  async function fileName(key) {
    return (await sha256(key)).slice(0, 32);
  }
  root.nnDemoCanon = { requestKey: requestKey, fileName: fileName, canonQuery: canonQuery, canonBody: canonBody };
})(typeof self !== "undefined" ? self : globalThis);
