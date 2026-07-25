import * as React from "react"
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert"
import { Terminal } from "../components/ui/terminal"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { AlertCircle, HelpCircle, Timer, AlertOctagon, ArrowLeft, RefreshCw, XCircle } from "lucide-react"

export type EdgeCaseErrorType = 
  | 'inconclusive'
  | 'timeout'
  | 'system_error'
  | 'invalid_ref'
  | 'oversized_repo'
  | 'payment_failure'
  | 'expired_logs';

export function SceneErrorEdgeCases({ errorType, onRetry, onBack }: { errorType: EdgeCaseErrorType, onRetry?: () => void, onBack?: () => void }) {
  const config = {
    inconclusive: {
      badgeVariant: "inconclusive" as const,
      badgeText: "INCONCLUSIVE",
      title: "Run Inconclusive",
      description: "The execution finished but the result could not be definitively verified. This often happens if the skill lacks a clear PASS/FAIL hook.",
      icon: <HelpCircle className="w-4 h-4" />,
      logs: [
        "$ proofrunner execute --skill custom-script",
        "> Running custom script...",
        "Script finished with exit code 0.",
        "WARN: No standard proof artifacts were emitted.",
        "ERR! Verdict is INCONCLUSIVE."
      ]
    },
    timeout: {
      badgeVariant: "timeout" as const,
      badgeText: "TIMEOUT",
      title: "Execution Timeout",
      description: "The runner exceeded the maximum allowed execution time of 180 seconds.",
      icon: <Timer className="w-4 h-4" />,
      logs: [
        "$ proofrunner execute --skill heavy-test",
        "> Running heavy test suite...",
        "Executing tests (1/100)...",
        "Executing tests (42/100)...",
        "ERR! Process terminated: Timeout (180s) reached."
      ]
    },
    system_error: {
      badgeVariant: "system_error" as const,
      badgeText: "SYSTEM ERROR",
      title: "Internal System Error",
      description: "An unexpected error occurred in our infrastructure. Our engineers have been notified.",
      icon: <AlertOctagon className="w-4 h-4" />,
      logs: [
        "$ proofrunner prepare-environment",
        "> Provisioning secure sandbox...",
        "ERR! Failed to attach volume: EIO.",
        "ERR! Internal orchestration failure."
      ]
    },
    invalid_ref: {
      badgeVariant: "fail" as const,
      badgeText: "INVALID REF",
      title: "Invalid Git Reference",
      description: "The provided branch, tag, or commit SHA does not exist in the repository.",
      icon: <XCircle className="w-4 h-4" />,
      logs: [
        "$ git ls-remote https://github.com/ever-guild/proof-runner",
        "ERR! fatal: ambiguous argument 'non-existent-branch': unknown revision."
      ]
    },
    oversized_repo: {
      badgeVariant: "fail" as const,
      badgeText: "OVERSIZED",
      title: "Repository Too Large",
      description: "The repository exceeds the maximum allowed size (500MB) for execution.",
      icon: <XCircle className="w-4 h-4" />,
      logs: [
        "$ git clone https://github.com/massive/repo.git",
        "> Fetching objects...",
        "Receiving objects: 100% (4123/4123), 1.2 GiB | 45.00 MiB/s",
        "ERR! Clone aborted: repository size exceeds 500MB quota."
      ]
    },
    payment_failure: {
      badgeVariant: "fail" as const,
      badgeText: "PAYMENT FAILED",
      title: "Payment Required",
      description: "We could not verify the payment for this execution. Please check your billing settings.",
      icon: <AlertCircle className="w-4 h-4" />,
      logs: [
        "$ proofrunner verify-payment",
        "> Checking ASP balance...",
        "ERR! Insufficient funds or payment declined."
      ]
    },
    expired_logs: {
      badgeVariant: "queued" as const,
      badgeText: "EXPIRED",
      title: "Logs Expired",
      description: "The raw execution logs for this run have expired and are no longer available. Only the cryptographic receipt remains.",
      icon: <Timer className="w-4 h-4" />,
      logs: [
        "Logs are purged after 30 days for privacy and storage reasons.",
        "To view details, you must run the verification again."
      ]
    }
  };

  const { badgeVariant, badgeText, title, description, icon, logs } = config[errorType];

  return (
    <div className="space-y-6 max-w-4xl w-full mx-auto p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-semibold text-slate-100">{title}</h2>
          <p className="text-sm md:text-base text-slate-400 mt-1 max-w-xl">{description}</p>
        </div>
        <Badge variant={badgeVariant}>{badgeText}</Badge>
      </div>

      <Alert variant={badgeVariant === "fail" || badgeVariant === "system_error" ? "destructive" : badgeVariant as any}>
        {icon}
        <AlertTitle>{badgeText}</AlertTitle>
        <AlertDescription>
          {description}
        </AlertDescription>
      </Alert>

      <Terminal 
        className="h-[300px] md:h-[400px]"
        logs={logs} 
        collapsible
        defaultExpanded={true}
      />

      <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4">
        <Button variant="ghost" onClick={onBack} className="w-full sm:w-auto">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to setup
        </Button>
        <Button variant="primary" onClick={onRetry} className="w-full sm:w-auto">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry Execution
        </Button>
      </div>
    </div>
  )
}
