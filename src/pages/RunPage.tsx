import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Terminal } from "../components/ui/terminal"
import { Badge } from "../components/ui/badge"
import { Card, CardHeader, CardContent, CardTitle } from "../components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert"
import { Button } from "../components/ui/button"
import { AlertCircle } from "lucide-react"

export function RunPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const isDemoFail = id === 'fail-demo'
  const [step, setStep] = React.useState(0)

  React.useEffect(() => {
    if (step < 6) {
      const timer = setTimeout(() => setStep(s => s + 1), 800)
      return () => clearTimeout(timer)
    } else {
      // Transition to receipt after logs finish
      setTimeout(() => {
        navigate(`/receipts/${id}`)
      }, 2000)
    }
  }, [step, id, navigate])

  const steps = [
    { name: "Repository resolved", status: step > 0 ? "PASS" : "RUNNING" },
    { name: "Skill selected", status: step > 1 ? "PASS" : step === 1 ? "RUNNING" : "WAITING" },
    { name: "Sandbox created", status: step > 2 ? "PASS" : step === 2 ? "RUNNING" : "WAITING" },
    { name: "Dependencies installed", status: step > 3 ? "PASS" : step === 3 ? "RUNNING" : "WAITING" },
    { name: "Project built", status: step > 4 ? "PASS" : step === 4 ? "RUNNING" : "WAITING" },
    { name: "Unit tests", status: step > 5 ? (isDemoFail ? "FAIL" : "PASS") : step === 5 ? "RUNNING" : "WAITING" },
    { name: "Receipt generated", status: step > 6 ? "PASS" : step === 6 ? "RUNNING" : "WAITING" },
  ]

  const logsPass = [
    "> Initializing sandbox...",
    "> Running ESLint...",
    "PASS: No linting errors.",
    "> Running Vitest suite...",
    "Running 24 tests",
    "24 passed",
    "SUCCESS: Proof complete."
  ]

  const logsFail = [
    "> Initializing sandbox...",
    "> Running Vitest suite...",
    "Running 24 tests",
    "23 passed",
    "1 failed",
    "FAIL: src/components/Badge.test.tsx",
    "  Expected element to have class 'bg-pass/10'",
    "  Received: 'bg-fail/10'",
    "ERR! Execution halted."
  ]

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Verification in progress</h1>
        <p className="text-slate-400 font-mono text-sm">ever-guild/proof-runner • Commit 91bd7a2</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column - Steps & Terminal */}
        <div className="md:col-span-2 space-y-8">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4 font-mono text-sm">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className={s.status === "WAITING" ? "text-slate-600" : "text-slate-300"}>{s.name}</span>
                    {s.status === "PASS" && <span className="text-pass">PASS</span>}
                    {s.status === "FAIL" && <span className="text-fail">FAIL</span>}
                    {s.status === "RUNNING" && <span className="text-running animate-pulse">RUNNING</span>}
                    {s.status === "WAITING" && <span className="text-slate-600">WAITING</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {isDemoFail && step > 5 && (
            <Alert variant="destructive" className="animate-fade-in-up">
              <AlertCircle className="w-4 h-4" />
              <AlertTitle>Verification failed</AlertTitle>
              <AlertDescription>
                1 reproducible failure found. Execution halted.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Execution Log</h3>
              <Button variant="ghost" size="sm">Show full log</Button>
            </div>
            <Terminal logs={isDemoFail ? logsFail.slice(0, step) : logsPass.slice(0, step)} className="h-[300px]" />
          </div>
        </div>

        {/* Right Column - Metadata */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-slate-500">Execution Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm font-mono text-slate-300">
              <div>
                <p className="text-slate-500 text-xs">Runtime</p>
                <p>node:22</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Skill</p>
                <p>node-typescript-acceptance@0.1.0</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Skill commit</p>
                <p>7c1e221</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Started</p>
                <p>20:42:18 UTC</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Elapsed</p>
                <p>00:0{step}s</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
