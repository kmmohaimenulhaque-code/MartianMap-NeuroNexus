/*
 * Loads the ArcGIS Maps SDK for JavaScript (AMD build) from Esri's CDN once,
 * on first use of the 3D view. No npm dependency is added and the 2D app
 * never pays the cost unless the 3D map is opened.
 */

export const ARCGIS_VERSION = "4.33";

let sdkPromise = null;

export function loadArcGIS() {
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
