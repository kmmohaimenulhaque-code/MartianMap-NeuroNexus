import { defineConfig } from "vitest/config";

// Vitest 3 runs on its own Vite 7, where @vitejs/plugin-react v6 (built for Vite 8) does not set the
// JSX runtime. Tests only need the automatic runtime, so they use this config instead of vite.config.js.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { include: ["src/**/*.test.{js,jsx}"] },
});
