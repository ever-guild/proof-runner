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
          The codebase was autonomously fixed, all tests passed, and the cryptographic receipt has been generated.
        </p>
      </div>

      <Card className="border-pass/30 shadow-[0_0_30px_rgba(16,185,129,0.1)] relative overflow-hidden">
        {/* Decorative corner glow */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-pass/20 blur-3xl rounded-full pointer-events-none" />
        
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-pass">Cryptographic Receipt</CardTitle>
            <Badge variant="pass">MINTED</Badge>
          </div>
          <CardDescription>Execution verified on-chain.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 relative z-10">
          <div className="space-y-1">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Transaction Hash</p>
            <p className="font-mono text-sm text-slate-300 break-all bg-slate-950 p-2 rounded border border-slate-800">
              0x7f4a28b991c1032a4e9b7f5d91c2b4a8e2f9d1c3a6b5e8c7d9a1b2c3d4e5f6g7
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Agent</p>
              <p className="font-mono text-sm text-slate-300">Antigravity-v2</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Cost</p>
              <p className="font-mono text-sm text-slate-300">0.0042 ETH</p>
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
