/* Static demo mode (VITE_DEMO_PACK=1 builds): register the replay service worker before the app renders. */

export const DEMO_PACK = import.meta.env.VITE_DEMO_PACK === "1";

export async function bootDemo() {
  if (!DEMO_PACK || !("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/demo-sw.js");
  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
    setTimeout(resolve, 4000);
  });
}
