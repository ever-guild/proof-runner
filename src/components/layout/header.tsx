import * as React from "react"
import { ShieldCheck } from "lucide-react"
import { Button } from "../ui/button"
import { Link } from "react-router-dom"

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/20 bg-black/60 backdrop-blur-2xl shadow-sm">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity">
            <ShieldCheck className="w-6 h-6 text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
            <div className="flex flex-col leading-none">
              <span className="font-bold tracking-tight text-lg">ProofRunner</span>
              <span className="text-[10px] text-slate-300 font-mono tracking-widest uppercase font-semibold">by Ever Guild</span>
            </div>
          </Link>
          
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-300">
            <a href="/#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <a href="/examples/passed" className="hover:text-white transition-colors">Demo source reference</a>
            <a href="/#for-agents" className="hover:text-white transition-colors">For agents</a>
            <a href="/#security" className="hover:text-white transition-colors">Security</a>
            <a href="https://github.com/ever-guild/proof-runner" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">GitHub</a>
          </nav>
        </div>

        <div>
          <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex font-semibold">
            <a href="/#verify">Preview verification</a>
          </Button>
        </div>
      </div>
    </header>
  )
}
