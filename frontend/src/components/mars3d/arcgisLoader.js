/*
 * Loads the ArcGIS Maps SDK for JavaScript (AMD build) from Esri's CDN once,
 * on first use of the 3D view. No npm dependency is added and the 2D app
 * never pays the cost unless the 3D map is opened.
 */

export const ARCGIS_VERSION = "4.33";

let sdkPromise = null;
let webglMode = null;

/*
 * The SDK's SceneView creates its WebGL2 context with failIfMajorPerformanceCaveat: true and refuses to start
 * when the browser renders WebGL in software (hardware acceleration off, VMs, remote desktops, some
 * locked-down machines). The globe does not need a GPU, only WebGL, so the 3D view drops that one flag and
 * renders in software instead of failing. It returns "hardware", "software" or "none" so the view can say
 * which one it got. The rendering itself is unchanged.
 */
/* "hardware" | "software" | "none" for this browser, without changing anything (Browser Optimization panel). */
export function detectWebGLMode() {
  if (webglMode) return webglMode;
  try {
    if (document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true })) return "hardware";
    return document.createElement("canvas").getContext("webgl2") ? "software" : "none";
  } catch {
    return "none";
  }
}

export function enableSoftwareWebGLFallback() {
  if (webglMode) return webglMode;
  try {
    const probe = document.createElement("canvas");
    if (probe.getContext("webgl2", { failIfMajorPerformanceCaveat: true })) webglMode = "hardware";
    else if (document.createElement("canvas").getContext("webgl2")) webglMode = "software";
    else webglMode = "none";
  } catch {
    webglMode = "none";
  }
  if (webglMode === "software") {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, options, ...rest) {
      if ((type === "webgl2" || type === "webgl") && options?.failIfMajorPerformanceCaveat) {
        return original.call(this, type, { ...options, failIfMajorPerformanceCaveat: false }, ...rest);
      }
      return original.call(this, type, options, ...rest);
    };
  }
  return webglMode;
}

/* Phones above 2x density: the idle high-quality pass renders at the full physical pixel ratio (3x on recent
   iPhones) and ignores qualitySettings.maximumPixelRatio, which risks the iOS Safari WebGL memory limit. */
export const capPhonePixelRatio = () => typeof window !== "undefined" && window.innerWidth < 768 && window.devicePixelRatio > 2;

export function loadArcGIS() {
  enableSoftwareWebGLFallback();
  if (!sdkPromise && capPhonePixelRatio()) {
    const config = globalThis.esriConfig ?? {};
    globalThis.esriConfig = { ...config, has: { ...config.has, "disable-feature:high-quality-idle": true } };
  }
  if (sdkPromise) {
    return sdkPromise;
  }
  sdkPromise = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-arcgis-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://js.arcgis.com/${ARCGIS_VERSION}/esri/themes/dark/main.css`;
      link.dataset.arcgisCss = "true";
      document.head.appendChild(link);
    }
    if (typeof window.require === "function" && window.require.toUrl) {
      resolve(window.require);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://js.arcgis.com/${ARCGIS_VERSION}/`;
    script.async = true;
    script.onload = () =>
      typeof window.require === "function" ? resolve(window.require) : reject(new Error("ArcGIS Maps SDK loaded without its module loader."));
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("ArcGIS Maps SDK could not be loaded from js.arcgis.com (check the network connection)."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function requireModules(names) {
  return loadArcGIS().then(
    (amdRequire) =>
      new Promise((resolve, reject) => {
        amdRequire(names, (...modules) => resolve(modules), reject);
      }),
  );
}
