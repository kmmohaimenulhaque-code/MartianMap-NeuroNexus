import { useEffect, useRef, useState } from "react";

/*
 * Fallback when the ArcGIS SceneView cannot start (no WebGL at all, or a browser that blocks it): an interactive
 * orthographic globe drawn on a 2D canvas from the same MOLA colorized global basemap the 2D map uses
 * (/mars-mola-global.jpg, equirectangular 0-360 E). Drag to rotate; tap or click to select a coordinate.
 * It shows imagery only (no elevation, no 3D layers) and says so.
 */
const RAD = Math.PI / 180;
const MARKERS = [
  { label: "GALE", lat: -4.82, lon: 137.39 },
  { label: "JEZERO", lat: 18.44, lon: 77.45 },
];

export default function Globe2DFallback({ center, onSelectCoordinate, onReadout, reason }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const texture = useRef(null);
  const view = useRef({ lat: center?.lat ?? -4.8, lon: center?.lon ?? 137.4 });
  const drag = useRef(null);
  const frame = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      texture.current = { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
      setReady(true);
    };
    img.src = "/mars-mola-global.jpg";
  }, []);

  useEffect(() => {
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) view.current = { lat: center.lat, lon: center.lon };
  }, [center]);

  useEffect(() => {
    if (!ready) return undefined;
    const draw = () => {
      frame.current = 0;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap || !texture.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      const size = Math.max(64, Math.round(Math.min(cssW, cssH) * 0.92 * dpr));
      canvas.width = size;
      canvas.height = size;
      canvas.style.width = `${size / dpr}px`;
      canvas.style.height = `${size / dpr}px`;
      const ctx = canvas.getContext("2d");
      const out = ctx.createImageData(size, size);
      const { data, w, h } = texture.current;
      const R = size / 2;
      const lat0 = view.current.lat * RAD;
      const lon0 = view.current.lon * RAD;
      const sin0 = Math.sin(lat0);
      const cos0 = Math.cos(lat0);
      for (let y = 0; y < size; y += 1) {
        const ny = (R - y - 0.5) / R;
        for (let x = 0; x < size; x += 1) {
          const nx = (x + 0.5 - R) / R;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) continue;
          const z = Math.sqrt(1 - r2);
          const lat = Math.asin(z * sin0 + ny * cos0);
          const lon = lon0 + Math.atan2(nx, z * cos0 - ny * sin0);
          const u = ((((lon / RAD) % 360) + 360) % 360) / 360;
          const v = (90 - lat / RAD) / 180;
          const si = ((Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))) * 4);
          const shade = 0.35 + 0.65 * z;
          const di = (y * size + x) * 4;
          out.data[di] = data[si] * shade;
          out.data[di + 1] = data[si + 1] * shade;
          out.data[di + 2] = data[si + 2] * shade;
          out.data[di + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      ctx.font = `${12 * dpr}px var(--nn-font, sans-serif)`;
      for (const m of MARKERS) {
        const p = project(m.lat, m.lon, lat0, lon0, R);
        if (!p) continue;
        ctx.fillStyle = "#75e6ff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 * dpr, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillText(m.label, p.x + 7 * dpr, p.y + 4 * dpr);
      }
    };
    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(draw);
    };
    draw();
    view.current.redraw = schedule;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    ro?.observe(wrapRef.current);
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [ready]);

  const toLatLon = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const R = rect.width / 2;
    const nx = (event.clientX - rect.left - R) / R;
    const ny = (R - (event.clientY - rect.top)) / R;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2);
    const lat0 = view.current.lat * RAD;
    const lon0 = view.current.lon * RAD;
    const lat = Math.asin(z * Math.sin(lat0) + ny * Math.cos(lat0)) / RAD;
    const lon = ((((lon0 + Math.atan2(nx, z * Math.cos(lat0) - ny * Math.sin(lat0))) / RAD) % 360) + 360) % 360;
    return { lat, lon };
  };

  return (
    <div className="m3d-fallback" ref={wrapRef} data-testid="globe-2d-fallback">
      <canvas
        ref={canvasRef}
        aria-label="Mars globe (2D canvas fallback): drag to rotate, tap to select"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, lat: view.current.lat, lon: view.current.lon, moved: false };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (d) {
            const k = 180 / (canvasRef.current?.getBoundingClientRect().width || 300);
            if (Math.hypot(event.clientX - d.x, event.clientY - d.y) > 4) d.moved = true;
            view.current.lat = Math.max(-89, Math.min(89, d.lat + (event.clientY - d.y) * k));
            view.current.lon = d.lon - (event.clientX - d.x) * k;
            view.current.redraw?.();
          } else {
            const p = toLatLon(event);
            onReadout?.(p ? { lat: p.lat, lon: p.lon, z: null } : null);
          }
        }}
        onPointerUp={(event) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const p = toLatLon(event);
            if (p) {
              onReadout?.({ lat: p.lat, lon: p.lon, z: null });
              onSelectCoordinate?.({ latitude_deg: Number(p.lat.toFixed(6)), longitude_deg: Number(p.lon.toFixed(6)) });
            }
          }
        }}
      />
      <p className="m3d-fallback-note">
        2D GLOBE · the 3D scene could not start in this browser{reason ? ` (${String(reason).replace(/\.+$/, "")})` : ""}. Imagery only: MOLA colorized basemap, no elevation or 3D layers.
      </p>
    </div>
  );
}

function project(lat, lon, lat0, lon0, R) {
  const la = lat * RAD;
  const dl = lon * RAD - lon0;
  const cosc = Math.sin(lat0) * Math.sin(la) + Math.cos(lat0) * Math.cos(la) * Math.cos(dl);
  if (cosc < 0) return null;
  return { x: R + R * Math.cos(la) * Math.sin(dl), y: R - R * (Math.cos(lat0) * Math.sin(la) - Math.sin(lat0) * Math.cos(la) * Math.cos(dl)) };
}
