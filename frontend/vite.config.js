import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Three pages: the landing page (/), the mission console (/console/) and the tutorial gallery (/tutorials/).
      // The landing and gallery bundles never import console modules (ArcGIS, Leaflet, console state).
      input: {
        landing: resolve(root, 'index.html'),
        console: resolve(root, 'console/index.html'),
        tutorials: resolve(root, 'tutorials/index.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api/, ''),
      },

      '/terrain': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
    },
  },
})
