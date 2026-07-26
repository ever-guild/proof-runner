import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { Separator } from "../components/ui/separator"
import { Shield, GitBranch, ArrowRight } from "lucide-react"

export function Scene2Inspect({ onNext }: { onNext: () => void }) {
  return (
    <div className="w-full max-w-4xl mx-auto p-4 md:p-8 animate-fade-in-up">
      <Card className="w-full shadow-glass border-white/10 bg-black/40 backdrop-blur-xl">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Repository Inspection Demo</CardTitle>
              <CardDescription className="text-sm mt-1">
                ever-guild/proof-runner
              </CardDescription>
            </div>
            <Badge variant="pass">SUPPORTED</Badge>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4 text-sm text-slate-300">
            <div className="flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-md border border-white/10">
              <GitBranch className="w-4 h-4 text-slate-400" />
              <span className="font-medium text-slate-200">main</span>
            </div>
            <span className="text-slate-300 font-mono text-xs bg-slate-900 px-2 py-1 rounded">Commit: a1b2c3d</span>
          </div>

          <Separator className="bg-white/10" />

          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Available Skills</h4>
            
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/15 transition-colors gap-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100">Lint & Test Proof</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">Illustrates the selected verification profile for this demo flow.</p>
                </div>
              </div>
              <Button variant="primary" size="default" onClick={onNext} className="w-full sm:w-auto shrink-0 group">
                Select
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
            
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
