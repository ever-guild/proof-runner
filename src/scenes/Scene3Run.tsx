import * as React from "react"
import { Terminal } from "../components/ui/terminal"
import { Badge } from "../components/ui/badge"
import { Spinner } from "../components/ui/spinner"

export function Scene3Run({ onNext }: { onNext: () => void }) {
  React.useEffect(() => {
    // Automatically transition to the failure scene after 3 seconds for the demo
    const timer = setTimeout(onNext, 3000);
    return () => clearTimeout(timer);
  }, [onNext]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Executing Proof</h2>
          <p className="text-sm text-slate-400">Running selected skill in secure sandbox...</p>
        </div>
        <Badge variant="running">RUNNING</Badge>
      </div>

      <Terminal 
        className="h-[400px]"
        logs={[
          "$ proof-runner exec --skill lint-test",
          "> Initializing sandbox...",
          "> Downloading dependencies...",
          "Dependencies installed in 1.2s",
          "> Running ESLint...",
          "PASS: No linting errors.",
          "> Running Vitest suite...",
        ]} 
      />
      
      <div className="flex items-center justify-center py-4 gap-3 text-sm text-slate-400">
        <Spinner size="sm" />
        Awaiting execution results...
      </div>
    </div>
  )
}
