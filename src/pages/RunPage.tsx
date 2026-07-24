import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { AlertCircle, AlertOctagon, AlertTriangle, CircleCheck, Clock, Copy, Loader2, XCircle } from "lucide-react"
import { Terminal } from "../components/ui/terminal"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { demoReceipts, getDemoKind } from "../lib/demo"
import { getRun, type Run } from "../lib/api"

const STEP_DELAY_MS = 500

export function RunPage() {
  const { id } = useParams()
  const isDemo = !id || id === "demo-123" || id === "fail-demo" || id === "passed" || id === "broken" || window.location.pathname.includes("/examples/")
  return isDemo ? <DemoRunPage /> : <LiveRunPage id={id} />
}

function LiveRunPage({ id }: { id: string | undefined }) {
  const [run, setRun] = React.useState<Run | null>(null)
  const [error, setError] = React.useState("")
  const [copyLabel, setCopyLabel] = React.useState("Copy result URL")

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

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopyLabel("Copied!")
    setTimeout(() => setCopyLabel("Copy result URL"), 2000)
  }

  if (error) return <div className="container mx-auto max-w-3xl px-4 py-16"><Alert variant="destructive"><AlertCircle className="w-4 h-4" /><AlertTitle>Verification unavailable</AlertTitle><AlertDescription className="break-all">{error}</AlertDescription></Alert></div>
  if (!run) return <div className="container mx-auto max-w-3xl px-4 py-16 text-slate-300 flex items-center gap-3" aria-live="polite"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /> Loading verification status…</div>

  const terminal = !["QUEUED", "RUNNING"].includes(run.status)
  const checks = run.report?.checks ?? []

  const isTimeout = run.status === "TIMEOUT"
  const isSystemError = run.status === "SYSTEM_ERROR"
  const isFail = run.verdict === "FAIL" && !isTimeout && !isSystemError
  const isPass = run.verdict === "PASS" && !isTimeout && !isSystemError

  const getVerdictIcon = () => {
    if (isPass) return <CircleCheck className="w-5 h-5 text-pass" />
    if (isFail) return <XCircle className="w-5 h-5 text-fail" />
    if (isTimeout) return <Clock className="w-5 h-5 text-amber-300" />
    if (isSystemError) return <AlertOctagon className="w-5 h-5 text-rose-400" />
    return <AlertTriangle className="w-5 h-5 text-amber-300" />
  }

  const getVerdictTitle = () => {
    if (isPass) return "Verdict: PASS"
    if (isFail) return "Verdict: FAIL (Code check failure)"
    if (isTimeout) return "Status: TIMEOUT (Execution limit exceeded — not code failure)"
    if (isSystemError) return `Status: SYSTEM_ERROR (${run.systemError?.code ?? "Infrastructure failure"} — not code failure)`
    return `Verdict: ${run.verdict ?? "INCONCLUSIVE"}`
  }

  const getBadgeVariant = (): "pass" | "fail" | "running" | "queued" | "inconclusive" | "timeout" | "system_error" => {
    if (run.status === "RUNNING") return "running"
    if (run.status === "QUEUED") return "queued"
    if (run.status === "TIMEOUT") return "timeout"
    if (run.status === "SYSTEM_ERROR") return "system_error"
    if (run.verdict === "PASS") return "pass"
    if (run.verdict === "FAIL") return "fail"
    return "inconclusive"
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-indigo-300">Live verification</p>
          <h1 className="text-2xl font-bold text-white mb-2">{terminal ? "Verification complete" : "Verification in progress"}</h1>
          <p className="text-slate-400 font-mono text-sm break-all">Run {run.id}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="gap-2 self-start sm:self-center" onClick={() => void copyUrl()}>
          <Copy className="w-3.5 h-3.5" /> {copyLabel}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4 font-mono text-sm" aria-live="polite">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">Run status</span>
                  <Badge variant={getBadgeVariant()}>{run.status}</Badge>
                </div>
                {run.activeStage && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-300">Current stage</span>
                    <span className="text-running animate-pulse flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {run.activeStage}</span>
                  </div>
                )}
                {run.queuePosition !== null && run.queuePosition !== undefined && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-slate-300">Queue position</span>
                    <span className="text-slate-300">#{run.queuePosition}</span>
                  </div>
                )}
                {checks.map((check) => (
                  <div key={check.id} className="flex items-center justify-between gap-4 py-1 border-t border-white/5">
                    <span className="text-slate-300 break-all">{check.title}</span>
                    <span className={
                      check.outcome === "FAILED" ? "text-fail flex items-center gap-1"
                        : check.outcome === "PASSED" ? "text-pass flex items-center gap-1"
                          : check.outcome === "INCONCLUSIVE" ? "text-amber-300 flex items-center gap-1"
                            : "text-slate-400"
                    }>
                      {check.outcome === "PASSED" && <CircleCheck className="w-3.5 h-3.5" />}
                      {check.outcome === "FAILED" && <XCircle className="w-3.5 h-3.5" />}
                      {check.outcome === "INCONCLUSIVE" && <AlertTriangle className="w-3.5 h-3.5" />}
                      {check.outcome}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {terminal && (
            <Alert variant={isFail ? "destructive" : "default"} className={`border ${isPass ? "border-pass/40 bg-pass/10" : isFail ? "border-fail/40 bg-fail/10" : "border-amber-500/40 bg-amber-500/10"}`}>
              {getVerdictIcon()}
              <AlertTitle className={`font-bold ${isPass ? "text-pass" : isFail ? "text-fail" : "text-amber-300"}`}>{getVerdictTitle()}</AlertTitle>
              <AlertDescription className="text-slate-300 mt-1 break-all">
                {run.systemError?.message ?? run.report?.reasonCode ?? (isTimeout ? "Verification timed out before completing all checks." : "Normalized verification evidence is shown above.")}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-slate-500">Evidence</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm font-mono text-slate-300">
              <div><p className="text-slate-500 text-xs">Started</p><p className="break-all">{run.startedAt ?? "Waiting"}</p></div>
              {run.completedAt && <div><p className="text-slate-500 text-xs">Completed</p><p className="break-all">{run.completedAt}</p></div>}
              {run.report && <div><p className="text-slate-500 text-xs">Duration</p><p>{run.report.durationMs} ms</p></div>}
              {run.links.receipt && (
                <Button asChild className="w-full">
                  <Link to={`/receipts/${run.id}`}>View signed receipt</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function DemoRunPage() {
  const { id } = useParams()
  const kind = getDemoKind(id, window.location.pathname)
  const receipt = demoReceipts[kind]
  const [completedSteps, setCompletedSteps] = React.useState(0)
  const [copyLabel, setCopyLabel] = React.useState("Copy result URL")
  const isComplete = completedSteps === receipt.checks.length + 1

  React.useEffect(() => {
    if (isComplete) return
    const timer = window.setTimeout(
      () => setCompletedSteps((current) => current + 1),
      STEP_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [completedSteps, isComplete])

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopyLabel("Copied!")
    setTimeout(() => setCopyLabel("Copy result URL"), 2000)
  }

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

  const tagLabel = kind === "broken" ? "demo-broken" : "demo-fixed"

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-amber-300">
            Demo simulation — no repository code is executed
          </p>
          <h1 className="text-2xl font-bold text-white mb-2">
            {isComplete ? "Demo verification complete" : "Demo verification in progress"}
          </h1>
          <p className="text-slate-400 font-mono text-sm break-all">
            {receipt.repository} • Tag <span className="text-indigo-300">{tagLabel}</span> ({receipt.commit.slice(0, 7)})
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="gap-2 self-start sm:self-center" onClick={() => void copyUrl()}>
          <Copy className="w-3.5 h-3.5" /> {copyLabel}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4 font-mono text-sm" aria-live="polite">
                {steps.map((step) => (
                  <div key={step.name} className="flex items-center justify-between gap-4 py-1 border-b border-white/5 last:border-0">
                    <span className={step.status === "WAITING" ? "text-slate-600 break-all" : "text-slate-300 break-all"}>{step.name}</span>
                    <span className={
                      step.status === "FAIL" ? "text-fail flex items-center gap-1"
                        : step.status === "PASS" ? "text-pass flex items-center gap-1"
                          : step.status === "RUNNING" ? "text-running animate-pulse flex items-center gap-1"
                            : "text-slate-600"
                    }>
                      {step.status === "PASS" && <CircleCheck className="w-3.5 h-3.5" />}
                      {step.status === "FAIL" && <XCircle className="w-3.5 h-3.5" />}
                      {step.status === "RUNNING" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {isComplete && (
            <Alert variant={kind === "broken" ? "destructive" : "default"} className={`animate-fade-in-up border ${kind === "broken" ? "border-fail/40 bg-fail/10" : "border-pass/40 bg-pass/10"}`}>
              {kind === "broken" ? <XCircle className="w-4 h-4 text-fail" /> : <CircleCheck className="w-4 h-4 text-pass" />}
              <AlertTitle className={kind === "broken" ? "text-fail font-bold" : "text-pass font-bold"}>
                Demo verdict: {receipt.verdict}
              </AlertTitle>
              <AlertDescription className="text-slate-300">{receipt.summary}</AlertDescription>
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
              <div><p className="text-slate-500 text-xs">Git tag</p><p className="text-indigo-300">{tagLabel}</p></div>
              <div><p className="text-slate-500 text-xs">Elapsed</p><p>00:0{Math.min(completedSteps, 9)}s (&lt; 45s limit)</p></div>
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

