import * as React from "react"
import { Server, Zap, ShieldCheck, GitBranch } from "lucide-react"

export function OpenGraphBanner() {
  return (
    <div className="w-[1200px] h-[630px] bg-[#030712] relative overflow-hidden flex flex-col items-center justify-center font-sans">
      {/* Background Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[800px] h-[800px] bg-violet-600/20 blur-[120px] rounded-full mix-blend-screen" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-indigo-600/20 blur-[100px] rounded-full mix-blend-screen" />
      
      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />

      {/* Content */}
      <div className="relative z-10 text-center flex flex-col items-center max-w-4xl">
        <div className="flex items-center gap-3 mb-8 bg-white/5 border border-white/10 px-6 py-2 rounded-full backdrop-blur-md shadow-glass">
          <Zap className="w-5 h-5 text-violet-400" />
          <span className="text-white font-medium tracking-wide">Proof Runner Protocol</span>
        </div>
        
        <h1 className="text-8xl font-bold tracking-tighter text-white mb-6 drop-shadow-2xl leading-tight">
          Run it. <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-indigo-400">Prove it.</span>
        </h1>
        
        <p className="text-2xl text-slate-300 max-w-2xl leading-relaxed mb-16">
          Autonomous execution and cryptographic receipts for your AI agent skills.
        </p>
        
        <div className="flex items-center gap-12 text-slate-400">
          <div className="flex items-center gap-3">
            <GitBranch className="w-8 h-8 text-slate-300" />
            <span className="text-xl font-medium">Any Repository</span>
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
          <div className="flex items-center gap-3">
            <Server className="w-8 h-8 text-violet-400" />
            <span className="text-xl font-medium text-slate-300">Isolated execution</span>
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-pass" />
            <span className="text-xl font-medium text-slate-300">Cryptographic Receipt</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function XBanner() {
  return (
    <div className="w-[1500px] h-[500px] bg-[#030712] relative overflow-hidden flex items-center justify-between px-32 font-sans">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:30px_30px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[400px] bg-violet-600/20 blur-[150px] rounded-full pointer-events-none" />
      
      <div className="relative z-10 max-w-3xl">
        <h1 className="text-7xl font-bold tracking-tighter text-white mb-4 leading-tight">
          Proof Runner
        </h1>
        <p className="text-3xl text-slate-300 font-light mb-8">
          The verification layer for <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-indigo-400 font-semibold">autonomous agents</span>.
        </p>
      </div>

      <div className="relative z-10 w-[400px] h-[280px] bg-black/40 border border-white/10 rounded-2xl shadow-glass backdrop-blur-xl p-8 flex flex-col justify-between">
         <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-pass" />
            <span className="text-2xl font-semibold text-slate-200">Receipt preview</span>
         </div>
         <div className="space-y-4">
           <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
             <div className="h-full bg-pass w-full" />
           </div>
           <div className="h-2 w-3/4 bg-white/5 rounded-full" />
           <div className="h-2 w-1/2 bg-white/5 rounded-full" />
         </div>
         <div className="font-mono text-sm text-slate-500 bg-white/5 p-3 rounded-lg border border-white/5 truncate">
           0x3f9b2d8e4a1c7f5e9d2b8a4c1e7f3b9d
         </div>
      </div>
    </div>
  )
}
