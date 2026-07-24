import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { AlertCircle, CircleCheck } from "lucide-react"
import { Terminal } from "../components/ui/terminal"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert"
import { Button } from "../components/ui/button"
import { demoReceipts, getDemoKind } from "../lib/demo"
import { getRun, type Run } from "../lib/api"

const STEP_DELAY_MS = 500

export function RunPage() {
  const { id } = useParams()
  const isDemo = !id || id === "demo-123" || id === "fail-demo" || window.location.pathname.includes("/examples/")
  return isDemo ? <DemoRunPage /> : <LiveRunPage id={id} />
}

function LiveRunPage({ id }: { id: string | undefined }) {
  const [run, setRun] = React.useState<Run | null>(null)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await getRun(id)
        if (cancelled) return
        setRun(next)
        setError("")
        if (next.status === "QUEUED" || next.status === "RUNNING") timer = window.setTimeout(() => void poll(), 1_500)
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Run status could not be loaded.")
      }
    }
    void poll()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [id])

  if (error) return <div className="container mx-auto max-w-3xl px-4 py-16"><Alert variant="destructive"><AlertCircle className="w-4 h-4" /><AlertTitle>Verification unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div>
  if (!run) return <div className="container mx-auto max-w-3xl px-4 py-16 text-slate-300" aria-live="polite">Loading verification status…</div>

  const terminal = !["QUEUED", "RUNNING"].includes(run.status)
  const verdictClass = run.verdict === "PASS" ? "text-pass" : run.verdict === "FAIL" ? "text-fail" : "text-amber-300"
  const checks = run.report?.checks ?? []
  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-8">
        <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-indigo-300">Live verification</p>
        <h1 className="text-2xl font-bold text-white mb-2">{terminal ? "Verification complete" : "Verification in progress"}</h1>
        <p className="text-slate-400 font-mono text-sm">Run {run.id}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Card><CardContent className="p-6"><div className="space-y-4 font-mono text-sm" aria-live="polite">
            <div className="flex justify-between gap-4"><span className="text-slate-300">Run status</span><span className="text-indigo-300">{run.status}</span></div>
            {run.activeStage && <div className="flex justify-between gap-4"><span className="text-slate-300">Current stage</span><span className="text-running animate-pulse">{run.activeStage}</span></div>}
            {run.queuePosition && <div className="flex justify-between gap-4"><span className="text-slate-300">Queue position</span><span className="text-slate-300">{run.queuePosition}</span></div>}
            {checks.map((check) => <div key={check.id} className="flex items-center justify-between gap-4"><span className="text-slate-300">{check.title}</span><span className={check.outcome === "FAILED" ? "text-fail" : check.outcome === "PASSED" ? "text-pass" : check.outcome === "INCONCLUSIVE" ? "text-amber-300" : "text-slate-400"}>{check.outcome}</span></div>)}
          </div></CardContent></Card>
          {terminal && <Alert variant={run.verdict === "FAIL" ? "destructive" : "default"}>
            {run.verdict === "PASS" ? <CircleCheck className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <AlertTitle className={verdictClass}>Verdict: {run.verdict ?? "INCONCLUSIVE"}</AlertTitle>
            <AlertDescription>{run.systemError?.message ?? run.report?.reasonCode ?? "Normalized verification evidence is shown above."}</AlertDescription>
          </Alert>}
        </div>
        <div className="space-y-6"><Card><CardHeader><CardTitle className="text-sm uppercase tracking-wider text-slate-500">Evidence</CardTitle></CardHeader><CardContent className="space-y-4 text-sm font-mono text-slate-300">
          <div><p className="text-slate-500 text-xs">Started</p><p>{run.startedAt ?? "Waiting"}</p></div>
          {run.report && <div><p className="text-slate-500 text-xs">Duration</p><p>{run.report.durationMs} ms</p></div>}
          {run.links.receipt && <Button asChild className="w-full"><Link to={`/receipts/${run.id}`}>View signed receipt</Link></Button>}
        </CardContent></Card></div>
      </div>
    </div>
  )
}

function DemoRunPage() {
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
