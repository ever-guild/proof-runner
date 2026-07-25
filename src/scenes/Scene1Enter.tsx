import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { FormField } from "../components/ui/form-field"
import { Play, ShieldAlert, Server, Zap } from "lucide-react"

export function Scene1Enter({ onNext }: { onNext: () => void }) {
  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-8 flex flex-col lg:flex-row gap-8 items-start animate-fade-in-up">
      {/* Hero Section */}
      <div className="flex-1 space-y-6 pt-4 lg:pt-12">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
          Run it. <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-indigo-500">Prove it.</span>
        </h1>
        <p className="text-lg md:text-xl text-slate-400 max-w-lg leading-relaxed">
          Autonomous execution and cryptographic receipts for your AI agent skills. Verify behavior instantly in our secure sandbox.
        </p>
        
        {/* ASP Card */}
        <div className="mt-8 p-4 rounded-xl border border-white/10 bg-white/5 flex items-start gap-4 max-w-sm backdrop-blur-sm">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0 border border-violet-500/30">
            <Server className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">ASP Network Enabled</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Execution is routed to our global Application Service Provider network for lowest latency.
            </p>
          </div>
        </div>
      </div>

      {/* Action Card */}
      <Card className="w-full lg:w-[480px] shrink-0 shadow-glass border-white/10 bg-black/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Zap className="w-5 h-5 text-violet-400" />
            Inspect Repository
          </CardTitle>
          <CardDescription className="text-sm text-slate-400 mt-2">
            Enter a GitHub repository URL to verify its state and execute autonomous skills.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <FormField 
              label="Repository URL" 
              placeholder="https://github.com/your-org/your-repo"
              defaultValue="https://github.com/ever-guild/proof-runner"
            />
            
            {/* Security Disclaimer */}
            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p>
                By proceeding, you agree to run untrusted code in an ephemeral sandbox. Code will have no access to the host network.
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end border-t border-white/5 pt-6 bg-white/[0.02]">
          <Button variant="primary" onClick={onNext} className="w-full sm:w-auto h-11 text-base group">
            <Play className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
            Start Inspection
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
