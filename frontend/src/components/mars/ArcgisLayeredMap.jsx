import { useEffect, useMemo, useRef, useState } from "react";

import { requireModules } from "../mars3d/arcgisLoader";
import { useLayers } from "../layers/layerStore";
import { GRID_LAYERS, dustImage, featureColor, gridImage, useTerrainGrid, walkRamp } from "../layers/sharedLayerData";
import { useDustFrame } from "../../state/dustFrames";
import { useSol } from "../../state/solStore";

/*
 * NeuroNexus ArcGIS view (2D MapView, Mars 2000 sphere, wkid 104971) in the USGS panel. It draws the same
 * USGS services as the 3D globe (Viking MDIM imagery, colorized MOLA, the SIM 3292 geologic units, contacts and
 * structures of Tanaka et al. 2014) plus every shared NeuroNexus layer this map supports: dust τ at the active
 * sol, slope / roughness / walkability heatmaps, DTM footprints, THEMIS observations, rover traverses and
 * waypoints, landing sites, IAU features, the planned route and safe havens. Layer state and opacity come from
 * the shared store, so the 2D map, this view and the 3D globe always agree. Clicking selects a coordinate.
 */
const MARS_SR = { wkid: 104971 };
const SERVICES = {
  imagery: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer",
  colorDem: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MColorDEM/MapServer",
  geology: "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer",
};
const lon180 = (lon) => ((((Number(lon) + 180) % 360) + 360) % 360) - 180;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const cssVar = (name) => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim());

export default function ArcgisLayeredMap({ center, halfWidthKm = 40, features = [], contextData = {}, thermalObs = [], routePoints = [], safeHavens = [], onSelectCoordinate }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const ownPickRef = useRef(null);
  const layersRef = useRef({});
  const graphicRef = useRef(null);
  const mediaRef = useRef(null);
  const selectRef = useRef(onSelectCoordinate);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const { visibility: v, opacity } = useLayers();
  const { sol } = useSol();
  const dust = useDustFrame(sol, Boolean(v.dust));
  const grid = useTerrainGrid(center, Boolean(v.slope || v.roughness || v.walkability));

  useEffect(() => {
    selectRef.current = onSelectCoordinate;
  }, [onSelectCoordinate]);

  /* ------------------------------------------------------------ create the MapView once */
  useEffect(() => {
    let destroyed = false;
    requireModules([
      "esri/Map", "esri/views/MapView", "esri/layers/TileLayer", "esri/layers/FeatureLayer", "esri/layers/GraphicsLayer", "esri/Graphic",
      "esri/layers/MediaLayer", "esri/layers/support/ImageElement", "esri/layers/support/ExtentAndRotationGeoreference", "esri/geometry/Extent",
      "esri/core/reactiveUtils",
    ])
      .then(([EsriMap, MapView, TileLayer, FeatureLayer, GraphicsLayer, Graphic, MediaLayer, ImageElement, Georeference, Extent, reactiveUtils]) => {
        if (destroyed || !containerRef.current) return;
        graphicRef.current = Graphic;
        // Dust and the terrain heatmaps are single images (MediaLayer), not thousands of polygons.
        mediaRef.current = { ImageElement, Georeference, Extent };
        const g = () => new GraphicsLayer();
        const media = () => new MediaLayer({ source: [], spatialReference: MARS_SR });
        const L = {
          imagery: new TileLayer({ url: SERVICES.imagery }),
          mola: new TileLayer({ url: SERVICES.colorDem }),
          units: new FeatureLayer({ url: `${SERVICES.geology}/3`, outFields: ["*"], popupEnabled: false }),
          contacts: new FeatureLayer({ url: `${SERVICES.geology}/1`, popupEnabled: false }),
          structures: new FeatureLayer({ url: `${SERVICES.geology}/2`, popupEnabled: false }),
          slope: media(), roughness: media(), walkability: media(), dust: media(), hiriseFootprints: g(),
          mslTraverse: g(), m2020Traverse: g(), waypoints: g(), themisObs: g(), landingSites: g(), features: g(), routes: g(), selection: g(),
        };
        layersRef.current = L;
        const map = new EsriMap({
          layers: [L.imagery, L.mola, L.units, L.contacts, L.structures, L.dust, L.slope, L.roughness, L.walkability, L.hiriseFootprints,
            L.mslTraverse, L.m2020Traverse, L.waypoints, L.themisObs, L.landingSites, L.features, L.routes, L.selection],
        });
        const view = new MapView({ container: containerRef.current, map, spatialReference: MARS_SR, center: [137.4, -4.6], scale: 4000000, constraints: { rotationEnabled: false }, popupEnabled: false });
        view.ui.move("zoom", "top-left");
        view.on("click", (event) => {
          const mp = event.mapPoint;
          if (!mp) return;
          const pick = { latitude_deg: Number(mp.y.toFixed(6)), longitude_deg: Number((((mp.x % 360) + 360) % 360).toFixed(6)) };
          ownPickRef.current = `${pick.latitude_deg.toFixed(4)},${pick.longitude_deg.toFixed(4)}`;
          selectRef.current?.(pick);
        });
        // Current center for the device tests (and anyone inspecting the page): "lat,lon" in degrees, east 0-360.
        reactiveUtils.watch(() => view.stationary, (still) => {
          if (still && view.center && containerRef.current)
            containerRef.current.dataset.center = `${view.center.y.toFixed(4)},${(((view.center.x % 360) + 360) % 360).toFixed(4)}`;
        });
        viewRef.current = view;
        view.when(() => !destroyed && setReady(true), (e) => !destroyed && setError(e?.message ?? "ArcGIS view failed"));
      })
      .catch((e) => !destroyed && setError(e.message));
    return () => {
      destroyed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  const rebuild = (key, graphics) => {
    const layer = layersRef.current[key];
    const Graphic = graphicRef.current;
    if (!layer || !Graphic) return;
    layer.removeAll();
    if (graphics.length) layer.addMany(graphics.map((x) => new Graphic(x)));
  };
  const pt = (lat, lon) => ({ type: "point", x: lon180(lon), y: Number(lat), spatialReference: MARS_SR });
  const dot = (color, size = 7, outline = [8, 16, 20, 0.9]) => ({ type: "simple-marker", style: "circle", color, size, outline: { color: outline, width: 1 } });

  /* ------------------------------------------------------------ follow the selection */
  const lat = center?.latitude_deg;
  const lon = center?.longitude_deg;
  useEffect(() => {
    if (!ready || lat == null || lon == null) return;
    const view = viewRef.current;
    rebuild("selection", [{ geometry: pt(lat, lon), symbol: { type: "simple-marker", style: "circle", size: 14, color: [0, 0, 0, 0], outline: { color: [1, 255, 255, 1], width: 2 } } }]);
    const key = `${Number(lat).toFixed(4)},${(((Number(lon) % 360) + 360) % 360).toFixed(4)}`;
    if (ownPickRef.current === key) return; // picked on this map: keep the user's view, the other maps follow
    // A plain { type: "extent" } target is silently ignored by goTo, so frame ±halfWidthKm with center + scale
    // (scale = ground metres across the view / screen metres across it at 96 dpi).
    const screenM = Math.max(200, Math.min(view.width || 0, view.height || 0) || 400) * (0.0254 / 96);
    const frame = (2 * halfWidthKm * 1000) / screenM;
    // Keep a zoom the user chose; only the opening (global) view is reframed to ±halfWidthKm.
    const scale = view.scale > frame * 4 ? frame : view.scale;
    view.goTo({ center: [lon180(lon), Number(lat)], scale }, { animate: false }).catch(() => {});
  }, [ready, lat, lon, halfWidthKm]);

  /* ------------------------------------------------------------ visibility + shared opacity */
  useEffect(() => {
    if (!ready) return;
    const L = layersRef.current;
    for (const [key, layer] of Object.entries(L)) if (key !== "selection") layer.visible = Boolean(v[key]);
    for (const id of ["mola", "units", "dust", "slope", "roughness", "walkability"]) if (L[id]) L[id].opacity = opacity[id] ?? 1;
  }, [ready, v, opacity]);

  /* ------------------------------------------------------------ data layers */
  const setImage = (key, url, xmin, ymin, xmax, ymax) => {
    const layer = layersRef.current[key];
    const M = mediaRef.current;
    if (!layer || !M) return;
    layer.source.elements.removeAll();
    if (!url) return;
    const extent = new M.Extent({ xmin, ymin, xmax, ymax, spatialReference: MARS_SR });
    layer.source.elements.add(new M.ImageElement({ image: url, georeference: new M.Georeference({ extent }) }));
  };
  const dustStops = useMemo(() => ["--nn-surface-2", "--nn-cyan", "--nn-amber"].map((t) => cssVar(t) || "#808080"), []);
  useEffect(() => {
    if (!ready) return;
    setImage("dust", v.dust && dust.data ? dustImage(dust.data, dustStops, true) : null, -180, -90, 180, 90);
  }, [ready, v.dust, dust.data, dustStops]);

  useEffect(() => {
    if (!ready) return;
    for (const id of Object.keys(GRID_LAYERS)) {
      const img = v[id] ? gridImage(grid.data, id) : null;
      if (!img) setImage(id, null);
      else {
        const [[lat0, lon0], [lat1, lon1]] = img.bounds;
        const x0 = lon180(lon0);
        setImage(id, img.url, x0, lat0, x0 + (lon1 - lon0), lat1);
      }
    }
  }, [ready, grid.data, v]);

  useEffect(() => {
    if (!ready) return;
    const traverses = contextData.traverses ?? {};
    for (const [rover, id, token] of [["msl", "mslTraverse", "--nn-rover-msl"], ["m2020", "m2020Traverse", "--nn-rover-m2020"]]) {
      const coords = traverses[rover] ?? [];
      const color = cssVar(token);
      rebuild(id, coords.length ? [{ geometry: { type: "polyline", paths: [coords.map(([x, y]) => [lon180(x), y])], spatialReference: MARS_SR }, symbol: { type: "simple-line", color: color.startsWith("#") ? rgb(color) : [255, 196, 107], width: 2.5 } }] : []);
    }
    const waypoints = contextData.waypoints ?? {};
    rebuild("waypoints", Object.entries(waypoints).flatMap(([rover, list]) => (list ?? []).map((w) => ({ geometry: pt(w.lat, w.lon), symbol: dot(rover === "msl" ? [255, 196, 107, 0.7] : [126, 214, 255, 0.7], 3 + (w.tilt ?? 0) / 4) }))));
    rebuild("landingSites", (contextData.landingSites ?? []).map((s) => ({ geometry: pt(s.latitude_deg, s.longitude_deg), symbol: { type: "simple-marker", style: "circle", size: 12, color: [0, 0, 0, 0], outline: { color: [232, 248, 252, 1], width: 2 } } })));
    rebuild("hiriseFootprints", (contextData.footprints ?? []).map((p) => {
      const [x0, y0, x1, y1] = p.bbox;
      const ok = p.asset_status?.status === "OK";
      return { geometry: { type: "polygon", rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]], spatialReference: MARS_SR }, symbol: { type: "simple-fill", color: [0, 0, 0, 0], outline: { color: ok ? [63, 188, 212, 1] : [255, 100, 124, 1], width: 1.5, style: ok ? "solid" : "dash" } } };
    }));
  }, [ready, contextData]);

  useEffect(() => {
    if (!ready) return;
    rebuild("themisObs", thermalObs.filter((o) => o.latitude_deg != null && o.longitude_deg != null).map((o) => ({ geometry: pt(o.latitude_deg, o.longitude_deg), symbol: dot([...walkRamp(o.brightness_temperature_k, 170, 290), 1], 9) })));
  }, [ready, thermalObs]);

  useEffect(() => {
    if (!ready) return;
    rebuild("features", features.filter((f) => f.latitude_deg != null).map((f) => ({ geometry: pt(f.latitude_deg, f.longitude_deg), symbol: dot([...rgb(featureColor(f.feature_type)), 0.9], 6) })));
  }, [ready, features]);

  useEffect(() => {
    if (!ready) return;
    const line = routePoints.length > 1 ? [{ geometry: { type: "polyline", paths: [routePoints.map((p) => [lon180(p.longitude_deg), Number(p.latitude_deg)])], spatialReference: MARS_SR }, symbol: { type: "simple-line", color: [1, 255, 255, 1], width: 3 } }] : [];
    const stops = routePoints.map((p) => ({ geometry: pt(p.latitude_deg, p.longitude_deg), symbol: dot([1, 255, 255, 1], 8) }));
    const havens = safeHavens.map((h) => ({ geometry: pt(h.latitude_deg, h.longitude_deg), symbol: dot([140, 240, 177, 1], 9) }));
    rebuild("routes", [...line, ...stops, ...havens]);
  }, [ready, routePoints, safeHavens]);

  return (
    <div className="nn-arcgis-layered" data-testid="arcgis-layered">
      <div className="nn-arcgis-view" ref={containerRef} />
      {!ready && !error && <div className="nn-arcgis-status">LOADING ARCGIS MAPVIEW · USGS SIM 3292 + SHARED LAYERS…</div>}
      {error && <div className="nn-arcgis-status is-error">ARCGIS VIEW UNAVAILABLE · {error}. The USGS APP tab still works.</div>}
      {grid.error && (v.slope || v.roughness || v.walkability) && <div className="nn-arcgis-note">Terrain grid unavailable: {grid.error}</div>}
    </div>
  );
}
