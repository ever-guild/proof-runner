import * as React from "react"
import { Header } from "./header"
import { Footer } from "./footer"

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col font-sans antialiased text-slate-300">
      <Header />
      <main className="flex-1 w-full animate-fade-in-up">
        {children}
      </main>
      <Footer />
    </div>
  )
}
