import * as React from "react"
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert"
import { Terminal } from "../components/ui/terminal"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { AlertCircle, ArrowRight } from "lucide-react"

export function Scene4Failure({ onNext }: { onNext: () => void }) {
  return (
    <div className="w-full max-w-4xl mx-auto p-4 md:p-8 space-y-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-semibold text-slate-100">Execution Halted</h2>
          <p className="text-sm md:text-base text-slate-400 mt-1">The proof run failed due to test errors.</p>
        </div>
        <Badge variant="fail">FAILED</Badge>
      </div>

      <Alert variant="destructive">
        <AlertCircle className="w-4 h-4" />
        <AlertTitle>Test Suite Failure</AlertTitle>
        <AlertDescription>
          1 deterministic demo test failed in <code className="bg-fail/20 px-1.5 py-0.5 rounded text-xs font-mono ml-1">src/components/Badge.test.tsx</code>.
        </AlertDescription>
      </Alert>

      <Terminal 
        className="h-[300px] md:h-[400px]"
        collapsible
        defaultExpanded={true}
        logs={[
          "> Running Vitest suite...",
          "FAIL: src/components/Badge.test.tsx",
          "  Expected element to have class 'bg-pass/10'",
          "  Received: 'bg-fail/10'",
          "ERR! Execution halted."
        ]} 
      />

      <div className="flex justify-end pt-4">
        <Button variant="primary" onClick={onNext} className="w-full sm:w-auto group">
          Continue to fixed demo
          <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
        </Button>
      </div>
    </div>
  )
}
