import * as React from "react"
import { ShieldCheck } from "lucide-react"

export function Footer() {
  return (
    <footer className="w-full border-t border-white/10 bg-black/60 mt-32">
      <div className="container mx-auto px-4 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-1 md:col-span-1">
            <div className="flex items-center gap-2 text-slate-100 mb-4">
              <ShieldCheck className="w-6 h-6 text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
              <span className="font-bold tracking-tight text-lg text-white">ProofRunner</span>
            </div>
            <p className="text-sm text-slate-400 font-mono tracking-widest uppercase mb-4 font-semibold">by Ever Guild</p>
          </div>
          
          <div>
            <p className="text-sm font-bold text-slate-200 mb-4 tracking-wider uppercase">Product</p>
            <ul className="space-y-3 text-sm text-slate-300">
              <li><a href="/examples/passed" className="hover:text-violet-300 transition-colors font-medium">Demo source reference</a></li>
              <li><a href="/#for-agents" className="hover:text-violet-300 transition-colors font-medium">For agents</a></li>
              <li><a href="/skill.md" className="hover:text-violet-300 transition-colors font-medium">API contract</a></li>
              <li><a href="/#security" className="hover:text-violet-300 transition-colors font-medium">Security</a></li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-200 mb-4 tracking-wider uppercase">Machine-readable</p>
            <ul className="space-y-3 text-sm text-slate-300">
              <li><a href="/skill.md" className="hover:text-violet-300 transition-colors font-mono font-medium">skill.md</a></li>
              <li><a href="/llms.txt" className="hover:text-violet-300 transition-colors font-mono font-medium">llms.txt</a></li>
              <li><a href="https://github.com/ever-guild/proof-runner/blob/main/packages/schema/src/public.ts" target="_blank" rel="noreferrer" className="hover:text-violet-300 transition-colors font-medium">Receipt schema</a></li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-200 mb-4 tracking-wider uppercase">External</p>
            <ul className="space-y-3 text-sm text-slate-300">
              <li><a href="https://github.com/ever-guild" target="_blank" rel="noreferrer" className="hover:text-violet-300 transition-colors font-medium">GitHub</a></li>
              <li><a href="https://ever-guild.net" target="_blank" rel="noreferrer" className="hover:text-violet-300 transition-colors font-medium">Ever Guild</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/20 flex flex-col items-center text-center">
          <p className="text-sm text-slate-400 max-w-2xl leading-relaxed font-medium">
            Verification receipts describe the checks executed against an exact code revision. 
            They do not constitute a security guarantee.
          </p>
        </div>
      </div>
    </footer>
  )
}
