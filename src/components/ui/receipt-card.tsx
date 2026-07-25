import * as React from "react"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "./card"
import { ShieldCheck, Hash, DollarSign, Bot, ArrowUpRight } from "lucide-react"

export interface ReceiptCardProps {
  hash: string;
  price: string;
  agentInstruction: string;
  timestamp?: string;
  className?: string;
}

export function ReceiptCard({ hash, price, agentInstruction, timestamp, className }: ReceiptCardProps) {
  return (
    <Card className={`w-full bg-black/40 border-pass/30 shadow-inner-pass overflow-hidden ${className}`}>
      <CardHeader className="border-b border-pass/10 bg-pass/5 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-pass flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            Cryptographic Receipt
          </CardTitle>
          <a href={`/receipts/${hash}`} className="text-xs text-pass/70 hover:text-pass flex items-center gap-1 transition-colors">
            Verify <ArrowUpRight className="w-3 h-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <div className="space-y-1">
          <div className="text-xs text-slate-500 uppercase tracking-widest flex items-center gap-1.5 font-semibold">
            <Hash className="w-3.5 h-3.5" /> Canonical Hash
          </div>
          <div className="font-mono text-sm text-slate-300 break-all bg-white/5 p-2 rounded-md border border-white/5">
            {hash}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-xs text-slate-500 uppercase tracking-widest flex items-center gap-1.5 font-semibold">
              <Bot className="w-3.5 h-3.5" /> Agent Instruction
            </div>
            <div className="text-sm text-slate-300">
              {agentInstruction}
            </div>
          </div>
          
          <div className="space-y-1">
            <div className="text-xs text-slate-500 uppercase tracking-widest flex items-center gap-1.5 font-semibold">
              <DollarSign className="w-3.5 h-3.5" /> Execution Cost
            </div>
            <div className="font-mono text-sm text-pass font-medium">
              ${price}
            </div>
          </div>
        </div>
      </CardContent>
      {timestamp && (
        <CardFooter className="pt-0 pb-4">
          <div className="text-xs text-slate-500 font-mono">
            Generated at {timestamp}
          </div>
        </CardFooter>
      )}
    </Card>
  )
}
