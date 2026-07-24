import * as React from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AppLayout } from './components/layout/app-layout'
import { LandingPage } from './pages/LandingPage'
import { RunPage } from './pages/RunPage'
import { ReceiptPage } from './pages/ReceiptPage'

function ScrollToTop() {
  const { pathname, hash } = useLocation()

  React.useEffect(() => {
    if (hash) {
      const frame = window.requestAnimationFrame(() => {
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
      })
      return () => window.cancelAnimationFrame(frame)
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AppLayout>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="/receipts/:id" element={<ReceiptPage />} />
          
          {/* Aliases for the demo links */}
          <Route path="/examples/passed" element={<ReceiptPage />} />
          <Route path="/examples/broken" element={<ReceiptPage />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}

export default App
