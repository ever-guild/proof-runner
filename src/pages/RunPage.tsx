import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { AlertCircle, CircleCheck } from "lucide-react"
import { Terminal } from "../components/ui/terminal"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert"
import { Button } from "../components/ui/button"
import { demoReceipts, getDemoKind } from "../lib/demo"

const STEP_DELAY_MS = 500

export function RunPage() {
  const { id } = useParams()
  const kind = getDemoKind(id, window.location.pathname)
  const receipt = demoReceipts[kind]
  const [completedSteps, setCompletedSteps] = React.useState(0)
  const isComplete = completedSteps === receipt.checks.length + 1

  React.useEffect(() => {
    if (isComplete) return
    const timer = window.setTimeout(
      () => setCompletedSteps((current) => current + 1),
      STEP_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [completedSteps, isComplete])

  const steps = [
    ...receipt.checks.map((check, index) => ({
      name: check.name,
      status:
        completedSteps > index
          ? check.outcome === "FAILED" ? "FAIL" : "PASS"
          : completedSteps === index ? "RUNNING" : "WAITING",
    })),
    {
      name: "Demo receipt generated",
      status:
        completedSteps > receipt.checks.length
          ? "PASS"
          : completedSteps === receipt.checks.length ? "RUNNING" : "WAITING",
    },
  ]

  const logs = kind === "broken"
    ? [
        "> Demo sandbox initialized",
        "> Demo build completed",
        "> Demo test suite: 4 passed, 1 failed",
        "FAIL: Unit tests",
        "Demo execution complete",
      ]
    : [
        "> Demo sandbox initialized",
        "> Demo build completed",
        "> Demo test suite: 5 passed",
        "PASS: All configured checks passed",
        "Demo execution complete",
      ]

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-8">
        <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-amber-300">
          Demo simulation — no repository code is executed
        </p>
        <h1 className="text-2xl font-bold text-white mb-2">
          {isComplete ? "Demo verification complete" : "Demo verification in progress"}
        </h1>
        <p className="text-slate-400 font-mono text-sm">
          {receipt.repository} • Commit {receipt.commit.slice(0, 7)}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4 font-mono text-sm" aria-live="polite">
                {steps.map((step) => (
                  <div key={step.name} className="flex items-center justify-between gap-4">
                    <span className={step.status === "WAITING" ? "text-slate-600" : "text-slate-300"}>{step.name}</span>
                    <span className={
                      step.status === "FAIL" ? "text-fail"
                        : step.status === "PASS" ? "text-pass"
                          : step.status === "RUNNING" ? "text-running animate-pulse"
                            : "text-slate-600"
                    }>
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {isComplete && (
            <Alert variant={kind === "broken" ? "destructive" : "default"} className="animate-fade-in-up">
              {kind === "broken" ? <AlertCircle className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />}
              <AlertTitle>Demo verdict: {receipt.verdict}</AlertTitle>
              <AlertDescription>{receipt.summary}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Normalized demo log</h2>
            <Terminal logs={logs.slice(0, Math.min(completedSteps, logs.length))} className="h-[300px]" />
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-slate-500">Demo details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm font-mono text-slate-300">
              <div><p className="text-slate-500 text-xs">Runtime</p><p>node:22 (sample)</p></div>
              <div><p className="text-slate-500 text-xs">Skill</p><p>{receipt.skill}</p></div>
              <div><p className="text-slate-500 text-xs">Elapsed</p><p>00:0{Math.min(completedSteps, 9)}s</p></div>
              {isComplete && (
                <Button asChild className="w-full">
                  <Link to={`/receipts/${kind}`}>View demo receipt</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
