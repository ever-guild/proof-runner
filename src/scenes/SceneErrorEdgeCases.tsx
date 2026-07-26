import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert"
import { Terminal } from "../components/ui/terminal"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { AlertCircle, HelpCircle, Timer, AlertOctagon, ArrowLeft, RefreshCw, XCircle, CircleOff } from "lucide-react"

export type EdgeCaseErrorType = 
  | 'inconclusive'
  | 'timeout'
  | 'system_error'
  | 'invalid_ref'
  | 'oversized_repo'
  | 'payment_failure'
  | 'expired_logs'
  | 'unsupported';

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
      description: "The configured execution time limit was reached before verification completed.",
      icon: <Timer className="w-4 h-4" />,
      logs: [
        "$ proofrunner execute --skill heavy-test",
        "> Running heavy test suite...",
        "Executing tests (1/100)...",
        "Executing tests (42/100)...",
        "ERR! Process terminated: configured timeout reached."
      ]
    },
    system_error: {
      badgeVariant: "system_error" as const,
      badgeText: "SYSTEM ERROR",
      title: "Internal System Error",
      description: "An unexpected runner or infrastructure error prevented a conclusive result.",
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
      description: "The repository exceeds the configured size limit for execution.",
      icon: <XCircle className="w-4 h-4" />,
      logs: [
        "$ git clone https://github.com/massive/repo.git",
        "> Fetching objects...",
        "Receiving objects: 100% (4123/4123), size limit exceeded.",
        "ERR! Clone aborted: repository exceeds the configured limit."
      ]
    },
    payment_failure: {
      badgeVariant: "fail" as const,
      badgeText: "PAYMENT FAILED",
      title: "Payment Required",
      description: "This launch-flow state is a design preview; payments are not configured in the demo.",
      icon: <AlertCircle className="w-4 h-4" />,
      logs: [
        "$ proofrunner verify-payment",
        "> Payment handling is unavailable in this demo.",
        "ERR! No payment provider is configured."
      ]
    },
    expired_logs: {
      badgeVariant: "queued" as const,
      badgeText: "EXPIRED",
      title: "Logs Expired",
      description: "This design state illustrates unavailable logs; retention depends on the deployment configuration.",
      icon: <Timer className="w-4 h-4" />,
      logs: [
        "Log retention is not available for this demo state.",
        "Run another verification to produce fresh evidence."
      ]
    },
    unsupported: {
      badgeVariant: "inconclusive" as const,
      badgeText: "UNSUPPORTED",
      title: "Repository Not Supported",
      description: "ProofRunner could not select a supported verification skill from the repository metadata.",
      icon: <CircleOff className="w-4 h-4" />,
      logs: [
        "$ proofrunner inspect https://github.com/example/repository",
        "> Reading repository metadata...",
        "ERR! NO_SUPPORTED_SKILL: no supported verification profile was found."
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

      <Alert variant={badgeVariant === "fail" ? "destructive" : badgeVariant === "system_error" ? "system_error" : badgeVariant === "timeout" ? "timeout" : badgeVariant === "inconclusive" ? "inconclusive" : "default"}>
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
