import type { AcceptanceDecision } from "../lib/api"
import { Badge } from "./ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"

const outcomeVariant = {
  ACCEPT: "pass",
  REMEDIATE: "fail",
  HUMAN_REVIEW: "inconclusive",
} as const

const reasonLabels: Record<string, string> = {
  EXECUTION_PASSED: "Execution passed",
  EXECUTION_FAILED: "Execution failed",
  EXECUTION_INCONCLUSIVE: "Execution was inconclusive",
  PROHIBITED_CONDITION_OBSERVED: "A prohibited condition was observed",
  REQUIRED_COVERAGE_EXECUTED: "All required criteria have executed evidence",
  REQUIRED_COVERAGE_INCOMPLETE: "Required criterion coverage is incomplete",
  UNSUPPORTED_CRITERION: "A required criterion is unsupported",
}

export function AcceptanceDecisionPanel({
  decision,
}: {
  decision: AcceptanceDecision
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-sm uppercase tracking-wider text-slate-400">
            Advisory acceptance decision
          </CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Unsigned · Policy v{decision.policyVersion} · Does not alter the signed receipt
          </p>
        </div>
        <Badge variant={outcomeVariant[decision.outcome]}>
          {decision.outcome}
        </Badge>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-slate-300">
          {decision.reasonCodes.map((reason) => (
            <li key={reason} className="break-words">
              {reasonLabels[reason] ?? reason}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
