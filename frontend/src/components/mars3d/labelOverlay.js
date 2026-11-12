/*
 * Persistent, decluttered map labels for the 3D SceneView.
 *
 * Labels are HTML elements projected with view.toScreen() on every camera
 * change, so they stay anchored to their coordinates, stay readable at any
 * distance, never grow huge, and are hidden on the far side of the planet.
 * Placement is greedy by priority (lower = more important) with screen-space
 * collision tests, like a road-map labeller. Pointer events pass through to
 * the globe.
 */

const MAX_LABELS = 160;
const DEG = Math.PI / 180;

function unitVector(latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

export function createLabelOverlay(view, container, radiusM = 3396190) {
  const pool = [];
  let entries = [];
  let frame = 0;
  let sampler = null;

  function element(i) {
    if (!pool[i]) {
      const el = document.createElement("div");
      el.className = "m3d-label";
      container.appendChild(el);
      pool[i] = el;
    }
    return pool[i];
  }

  function elevationAt(entry) {
    if (entry.z !== undefined) return entry.z;
    if (!sampler) return 0;
    try {
      const sampled = sampler.queryElevation({ type: "point", x: entry.x, y: entry.y, spatialReference: view.spatialReference });
      entry.z = Number.isFinite(sampled?.z) ? sampled.z : 0;
    } catch {
      entry.z = 0;
    }
    return entry.z;
  }

  function render() {
    frame = 0;
    if (!view.ready) return;
    const camera = view.camera?.position;
    if (!camera) return;
    const scale = view.scale;
    const camVec = unitVector(camera.y, camera.x).map((v) => v * (radiusM + (camera.z ?? 0)));
    const width = view.width;
    const height = view.height;
    const placed = [];
    let used = 0;

    for (const entry of entries) {
      if (used >= MAX_LABELS) break;
      if (entry.minScale && scale > entry.minScale) continue;
      // far-side culling: the point must face the camera
      const n = unitVector(entry.y, entry.x);
      const p = n.map((v) => v * radiusM);
      const toCam = [camVec[0] - p[0], camVec[1] - p[1], camVec[2] - p[2]];
      if (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] <= 0) continue;
      const screen = view.toScreen({ type: "point", x: entry.x, y: entry.y, z: elevationAt(entry), spatialReference: view.spatialReference });
      if (!screen || screen.x < -50 || screen.y < -20 || screen.x > width + 50 || screen.y > height + 20) continue;
      const w = entry.text.length * (entry.size * 0.62) + 10;
      const h = entry.size + 8;
      const box = { x0: screen.x - w / 2, x1: screen.x + w / 2, y0: screen.y - entry.offset - h, y1: screen.y - entry.offset };
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      placed.push(box);
      const el = element(used);
      if (el.textContent !== entry.text) el.textContent = entry.text;
      el.style.setProperty("--c", entry.colour);
      el.style.fontSize = `${entry.size}px`;
      el.dataset.kind = entry.kind;
      el.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y - entry.offset)}px) translate(-50%, -100%)`;
      el.style.display = "block";
      used += 1;
    }
    for (let i = used; i < pool.length; i += 1) pool[i].style.display = "none";
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  const handles = [view.watch("camera", schedule), view.watch("size", schedule), view.watch("stationary", schedule)];
  view.when(() => {
    sampler = view.groundView?.elevationSampler ?? null;
    entries.forEach((e) => delete e.z);
    schedule();
  });
  view.groundView?.watch?.("elevationSampler", (value) => {
    sampler = value;
    entries.forEach((e) => delete e.z);
    schedule();
  });

  return {
    setEntries(next) {
      entries = next
        .filter((e) => e.text)
        .map((e) => ({
          ...e,
          x: ((((Number(e.lon) + 180) % 360) + 360) % 360) - 180,
          y: Number(e.lat),
          size: e.size ?? 10,
          offset: e.offset ?? 14,
        }))
        .sort((a, b) => a.priority - b.priority);
      schedule();
    },
    refresh: schedule,
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      handles.forEach((h) => h?.remove?.());
      pool.forEach((el) => el.remove());
    },
  };
}
