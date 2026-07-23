import * as React from "react"
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert"
import { Terminal } from "../components/ui/terminal"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { AlertCircle, Wrench } from "lucide-react"

export function Scene4Failure({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Execution Halted</h2>
          <p className="text-sm text-slate-400">The proof run failed due to test errors.</p>
        </div>
        <Badge variant="fail">FAILED</Badge>
      </div>

      <Alert variant="destructive">
        <AlertCircle className="w-4 h-4" />
        <AlertTitle>Test Suite Failure</AlertTitle>
        <AlertDescription>
          1 test failed in <code className="bg-fail/20 px-1 rounded text-xs">src/components/Badge.test.tsx</code>. 
          The agent has analyzed the issue.
        </AlertDescription>
      </Alert>

      <Terminal 
        className="h-[400px]"
        logs={[
          "> Running Vitest suite...",
          "FAIL: src/components/Badge.test.tsx",
          "  Expected element to have class 'bg-pass/10'",
          "  Received: 'bg-fail/10'",
          "ERR! Execution halted."
        ]} 
      />

      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          <Wrench className="w-4 h-4 mr-2" />
          Auto-Fix Issue
        </Button>
      </div>
    </div>
  )
}
