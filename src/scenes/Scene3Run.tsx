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
    <div className="w-full max-w-4xl mx-auto p-4 md:p-8 space-y-4 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-semibold text-slate-100">Execution Demo</h2>
          <p className="text-sm md:text-base text-slate-400 mt-1">Previewing the configured verification flow…</p>
        </div>
        <Badge variant="running">RUNNING</Badge>
      </div>

      <Terminal 
        className="h-[300px] md:h-[400px]"
        collapsible
        defaultExpanded={true}
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
