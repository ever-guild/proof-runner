import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Copy, ExternalLink, Download } from "lucide-react"

export function ReceiptPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isFail = id === 'fail-demo'

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl animate-fade-in-up">
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-bold text-white mb-4">
          {isFail ? "Verification failed" : "Verification passed"}
        </h1>
        <p className="text-slate-400">
          {isFail ? "4 of 5 checks passed. 1 reproducible failure found." : "All 5 checks passed. Receipt issued for commit 4c82fa1"}
        </p>
      </div>

      <Card className={`relative overflow-hidden mb-8 border ${isFail ? 'border-fail/30' : 'border-pass/30'}`}>
        <div className={`absolute -top-24 -right-24 w-64 h-64 blur-[100px] rounded-full pointer-events-none ${isFail ? 'bg-fail/20' : 'bg-pass/20'}`} />
        
        <CardHeader className="border-b border-white/5 bg-black/20">
          <div className="flex items-center justify-between">
            <CardTitle className="tracking-wider uppercase text-sm text-slate-400">
              {isFail ? "Verification Receipt" : "Verified Delivery"}
            </CardTitle>
            <Badge variant={isFail ? "fail" : "pass"}>{isFail ? "FAIL" : "PASS"}</Badge>
          </div>
        </CardHeader>
        
        <CardContent className="p-0">
          <div className="divide-y divide-white/5 text-sm font-mono">
            <div className="grid grid-cols-3 p-4">
              <span className="text-slate-500">Repository</span>
              <span className="col-span-2 text-slate-300">ever-guild/proof-runner</span>
            </div>
            <div className="grid grid-cols-3 p-4">
              <span className="text-slate-500">Code commit</span>
              <span className="col-span-2 text-slate-300">4c82fa189c...</span>
            </div>
            <div className="grid grid-cols-3 p-4">
              <span className="text-slate-500">Verification skill</span>
              <span className="col-span-2 text-slate-300">node-typescript-acceptance</span>
            </div>
            <div className="grid grid-cols-3 p-4">
              <span className="text-slate-500">Report hash</span>
              <span className="col-span-2 text-indigo-400 break-all">0x7f4a28b991c1032a4e9b7f5d91c2b4a8e2f9d1c3a6b5e8c7d9a1b2c3d4e5f6g7</span>
            </div>
            <div className="grid grid-cols-3 p-4">
              <span className="text-slate-500">ProofRunner sig</span>
              <span className="col-span-2 text-slate-300 break-all">sig_9x8...</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-center gap-4 mb-16">
        <Button variant="secondary" className="gap-2"><Copy className="w-4 h-4" /> Copy receipt URL</Button>
        <Button variant="secondary" className="gap-2"><Download className="w-4 h-4" /> Download JSON</Button>
        <Button variant="primary" onClick={() => navigate('/')}>Verify another commit</Button>
      </div>

      <p className="text-xs text-center text-slate-500 max-w-xl mx-auto leading-relaxed border border-yellow-500/20 bg-yellow-500/5 p-4 rounded-xl">
        This receipt proves that the listed checks were executed successfully against this exact commit and runtime. It does not prove the absence of all defects or security vulnerabilities.
      </p>
    </div>
  )
}
