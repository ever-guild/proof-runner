import * as React from "react"
import { CheckCircle2, RotateCcw } from "lucide-react"
import { Button } from "../components/ui/button"
import { ReceiptCard } from "../components/ui/receipt-card"

export function Scene5Receipt({ onReset }: { onReset: () => void }) {
  return (
    <div className="space-y-8 max-w-4xl w-full mx-auto p-4 md:p-8 animate-fade-in-up">
      <div className="flex flex-col items-center justify-center text-center space-y-4 py-8">
        <div className="w-20 h-20 rounded-full bg-pass/10 flex items-center justify-center border border-pass/30 mb-2 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
          <CheckCircle2 className="w-10 h-10 text-pass drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        </div>
        <h2 className="text-3xl md:text-4xl font-bold text-slate-100 tracking-tight">Demo Result</h2>
        <p className="text-sm md:text-base text-slate-400 max-w-md">
          This sample shows how a completed verification and receipt summary may be presented. It is not a signed production receipt.
        </p>
      </div>

      <div className="flex justify-center">
        <ReceiptCard 
          className="max-w-2xl"
          hash="7f4a28b991c1032a4e9b7f5d91c2b4a8e2f9d1c3a6b5e8c7d9a1b2c3d4e5f607"
          price="0.0050"
          agentInstruction="node-typescript@1: demo execution"
          timestamp={new Date().toISOString()}
        />
      </div>

      <div className="flex justify-center pt-8 border-t border-white/5">
        <Button variant="ghost" onClick={onReset} className="group">
          <RotateCcw className="w-4 h-4 mr-2 group-hover:-rotate-90 transition-transform" />
          Run Another Proof
        </Button>
      </div>
    </div>
  )
}
