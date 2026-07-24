import * as React from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { CheckCircle2, RotateCcw } from "lucide-react"
import { Button } from "../components/ui/button"

export function Scene5Receipt({ onReset }: { onReset: () => void }) {
  return (
    <div className="space-y-8 animate-fade-in-up">
      <div className="flex flex-col items-center justify-center text-center space-y-4 py-8">
        <div className="w-16 h-16 rounded-full bg-pass/10 flex items-center justify-center border border-pass/30 mb-2">
          <CheckCircle2 className="w-8 h-8 text-pass" />
        </div>
        <h2 className="text-3xl font-semibold text-slate-100">Proof Verified</h2>
        <p className="text-slate-400 max-w-sm">
          The fixed demo revision passed all configured checks. This screen uses sample receipt data.
        </p>
      </div>

      <Card className="border-pass/30 shadow-[0_0_30px_rgba(16,185,129,0.1)] relative overflow-hidden">
        {/* Decorative corner glow */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-pass/20 blur-3xl rounded-full pointer-events-none" />
        
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-pass">Demo Receipt</CardTitle>
            <Badge variant="pass">PASS</Badge>
          </div>
          <CardDescription>Sample off-chain receipt layout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 relative z-10">
          <div className="space-y-1">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Report Hash</p>
            <p className="font-mono text-sm text-slate-300 break-all bg-slate-950 p-2 rounded border border-slate-800">
              7f4a28b991c1032a4e9b7f5d91c2b4a8e2f9d1c3a6b5e8c7d9a1b2c3d4e5f607
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Skill</p>
              <p className="font-mono text-sm text-slate-300">node-typescript@1</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Signature</p>
              <p className="font-mono text-sm text-slate-300">Not issued for demo data</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center pt-8">
        <Button variant="ghost" onClick={onReset}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Run Another Proof
        </Button>
      </div>
    </div>
  )
}
