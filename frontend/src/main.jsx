import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './utils/leafletGuards.js'
import './apiOrigin.js'
import './pwa/retireAppWorker.js'
import App from './App.jsx'
import ErrorBoundary from './ui/ErrorBoundary.jsx'
import DemoBanner from './demo/DemoBanner.jsx'
import { DEMO_PACK, bootDemo } from './demo/demoMode.js'

bootDemo().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      {DEMO_PACK && <DemoBanner recordedAt={import.meta.env.VITE_DEMO_RECORDED_AT} />}
      <ErrorBoundary label="CONSOLE">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})
