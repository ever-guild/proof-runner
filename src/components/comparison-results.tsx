import { Link } from "react-router-dom"
import { ArrowRight, GitCompareArrows, ShieldCheck } from "lucide-react"

import type { ComparisonEvidence, ComparisonResult } from "../lib/api"
import { Badge } from "./ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"

const verdictVariant = (
  verdict: ComparisonResult["baseline"]["verdict"],
): "pass" | "fail" | "inconclusive" =>
  verdict === "PASS" ? "pass" : verdict === "FAIL" ? "fail" : "inconclusive"

const classificationStyle: Record<
  ComparisonResult["checks"][number]["classification"],
  string
> = {
  RESOLVED: "border-pass/30 bg-pass/10 text-pass",
  NEW: "border-fail/30 bg-fail/10 text-fail",
  UNCHANGED: "border-white/10 bg-white/5 text-slate-300",
  ADDED: "border-indigo-400/30 bg-indigo-400/10 text-indigo-200",
  REMOVED: "border-slate-500/30 bg-slate-500/10 text-slate-400",
}

function EvidenceCard({
  label,
  evidence,
}: {
  label: string
  evidence: ComparisonEvidence
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          {label}
        </span>
        <Badge variant={verdictVariant(evidence.verdict)}>
          {evidence.verdict}
        </Badge>
      </div>
      <p className="break-all font-mono text-xs text-slate-300">
        {evidence.commitSha}
      </p>
      <Link
        className="mt-3 inline-block text-sm text-indigo-300 hover:text-indigo-200"
        to={`/receipts/${evidence.runId}`}
      >
        View signed receipt
      </Link>
    </div>
  )
}

export function ComparisonResults({
  comparison,
}: {
  comparison: ComparisonResult
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-indigo-300" />
            <div>
              <CardTitle className="text-lg">Compatible signed evidence</CardTitle>
              <p className="mt-1 text-xs text-slate-400">
                Same repository, contract, skill, and runtime image.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <EvidenceCard label="Baseline" evidence={comparison.baseline} />
          <ArrowRight className="mx-auto hidden h-5 w-5 text-slate-500 md:block" />
          <EvidenceCard label="Candidate" evidence={comparison.candidate} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center gap-3">
            <GitCompareArrows className="h-5 w-5 text-indigo-300" />
            <CardTitle className="text-lg">Check changes</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2 pt-3">
            {comparison.driftLabels.length === 0 ? (
              <span className="text-xs text-slate-500">No semantic drift detected</span>
            ) : (
              comparison.driftLabels.map((label) => (
                <span
                  className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 font-mono text-[11px] text-amber-200"
                  key={label}
                >
                  {label}
                </span>
              ))
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/5">
            {comparison.checks.map((check) => (
              <div
                className="grid gap-3 p-4 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center"
                key={check.checkId}
              >
                <span className="break-all font-mono text-slate-200">
                  {check.checkId}
                </span>
                <span className="font-mono text-xs text-slate-400">
                  {check.baselineOutcome ?? "—"}
                </span>
                <ArrowRight className="hidden h-3.5 w-3.5 text-slate-600 md:block" />
                <div className="flex items-center justify-between gap-3 md:justify-end">
                  <span className="font-mono text-xs text-slate-300">
                    {check.candidateOutcome ?? "—"}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${classificationStyle[check.classification]}`}
                  >
                    {check.classification}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-slate-500">
        Read-only evidence comparison. Signed receipts and verdicts are shown
        unchanged; no patches or fixes are generated.
      </p>
    </div>
  )
}
