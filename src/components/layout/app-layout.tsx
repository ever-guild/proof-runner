import * as React from "react"
import { Header } from "./header"
import { Footer } from "./footer"

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col font-sans antialiased text-slate-300 relative">
      {/* Photographic noise overlay */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none opacity-40 mix-blend-overlay"
        style={{ 
          imageRendering: "pixelated",
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='4' numOctaves='1' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` 
        }}
      />
      <div className="relative z-10 flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 w-full animate-fade-in-up">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  )
}
