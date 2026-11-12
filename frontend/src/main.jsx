import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './utils/leafletGuards.js'
// First: the shard cookie must exist before any /api request leaves the page.
import './shard.js'
import './apiOrigin.js'
// After apiOrigin.js: the tracker wraps the origin-rewriting fetch, so it sees every backend request.
import './state/fetchTracker.js'
import './pwa/retireAppWorker.js'
import App from './App.jsx'
import ErrorBoundary from './ui/ErrorBoundary.jsx'
import LoadingOverlay from './ui/LoadingOverlay.jsx'
import DemoBanner from './demo/DemoBanner.jsx'
import { DEMO_PACK, bootDemo } from './demo/demoMode.js'

bootDemo().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      {DEMO_PACK && <DemoBanner recordedAt={import.meta.env.VITE_DEMO_RECORDED_AT} />}
      <ErrorBoundary label="CONSOLE">
        <App />
      </ErrorBoundary>
      <ErrorBoundary label="LOADING STATUS">
        <LoadingOverlay />
      </ErrorBoundary>
    </StrictMode>,
  )
})
