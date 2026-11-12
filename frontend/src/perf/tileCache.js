/*
 * IndexedDB binary tile cache (terrain windows, overlay PNGs, rover snapshots), capped at 150 MB with
 * least-recently-used eviction. It shares the "neuronexus" database with the USGS snapshot store; the
 * upgrade to version 2 adds the tile store and keeps every existing snapshot entry.
 */

export const CAP_BYTES = 150 * 2 ** 20;
const DB_NAME = "neuronexus";
const DB_VERSION = 2;
const TILES = "tiles";

/* LRU bookkeeping on plain records, shared by the IndexedDB and in-memory backends (tested). */
export function planEviction(records, incomingBytes, cap = CAP_BYTES) {
  const total = records.reduce((a, r) => a + r.size, 0) + incomingBytes;
  if (total <= cap) return [];
  const sorted = [...records].sort((a, b) => a.lastAccess - b.lastAccess || a.key.localeCompare(b.key));
  const evict = [];
  let excess = total - cap;
  for (const r of sorted) {
    if (excess <= 0) break;
    evict.push(r.key);
    excess -= r.size;
  }
  return evict;
}

export function memoryBackend() {
  const map = new Map();
  return {
    all: async () => [...map.values()],
    get: async (key) => map.get(key) ?? null,
    put: async (record) => map.set(record.key, record),
    remove: async (key) => map.delete(key),
    clear: async () => map.clear(),
  };
}

/* The one opener for the shared database (USGS snapshots + tiles). */
export function openNeuronexusDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("usgsSnapshots")) db.createObjectStore("usgsSnapshots");
      if (!db.objectStoreNames.contains(TILES)) db.createObjectStore(TILES, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function indexedDbBackend() {
  const run = (mode, fn) =>
    openNeuronexusDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(TILES, mode);
          const result = fn(tx.objectStore(TILES));
          tx.oncomplete = () => resolve(result.result ?? result.value);
          tx.onerror = () => reject(tx.error);
        }),
    );
  return {
    all: () => run("readonly", (s) => s.getAll()),
    get: (key) => run("readonly", (s) => s.get(key)).then((r) => r ?? null),
    put: (record) => run("readwrite", (s) => s.put(record)),
    remove: (key) => run("readwrite", (s) => s.delete(key)),
    clear: () => run("readwrite", (s) => s.clear()),
  };
}

export function createTileCache(backend = indexedDbBackend(), cap = CAP_BYTES, clock = () => Date.now()) {
  return {
    async get(key) {
      try {
        const record = await backend.get(key);
        if (!record) return null;
        await backend.put({ ...record, lastAccess: clock() });
        return record.blob;
      } catch {
        return null;
      }
    },
    async put(key, blob) {
      try {
        const size = blob.size ?? blob.byteLength ?? 0;
        if (size > cap) return false;
        const records = (await backend.all()).filter((r) => r.key !== key);
        for (const victim of planEviction(records, size, cap)) await backend.remove(victim);
        await backend.put({ key, blob, size, lastAccess: clock() });
        return true;
      } catch {
        return false;
      }
    },
    async stats() {
      try {
        const records = await backend.all();
        return { entries: records.length, bytes: records.reduce((a, r) => a + r.size, 0), capBytes: cap };
      } catch {
        return { entries: 0, bytes: 0, capBytes: cap, unavailable: true };
      }
    },
    async purge() {
      try {
        await backend.clear();
      } catch {
        // Nothing cached.
      }
    },
  };
}

let shared = null;
export function tileCache() {
  shared ??= createTileCache();
  return shared;
}

/* Cached fetch of a binary resource; returns an object URL (caller revokes) or the plain URL on failure. */
export async function cachedObjectUrl(url, enabled = true) {
  if (!enabled || typeof fetch === "undefined") return url;
  const cache = tileCache();
  let blob = await cache.get(url);
  if (!blob) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
    cache.put(url, blob);
  }
  if (typeof createImageBitmap === "function" && blob.type?.startsWith("image/")) {
    // Decode off the main thread first, so the <img> that shows it does not stall a frame.
    try {
      (await createImageBitmap(blob)).close();
    } catch {
      // Not decodable here; the browser will try again when it is shown.
    }
  }
  return URL.createObjectURL(blob);
}
