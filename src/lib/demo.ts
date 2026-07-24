export type DemoKind = "passed" | "broken" | "timeout" | "system-error" | "inconclusive"

export interface DemoReceipt {
  id: DemoKind
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE"
  status: "COMPLETED" | "TIMEOUT" | "SYSTEM_ERROR"
  gitTag: string
  summary: string
  repository: string
  commit: string
  skill: string
  reportHash: string
  systemError?: { code: string; message: string; retryable: boolean }
  checks: Array<{ name: string; outcome: "PASSED" | "FAILED" | "INCONCLUSIVE" | "TIMEOUT" | "SYSTEM_ERROR" }>
}

const common = {
  repository: "ever-guild/proof-runner",
  skill: "node-typescript@1",
}

export const demoReceipts: Record<DemoKind, DemoReceipt> = {
  passed: {
    id: "passed",
    verdict: "PASS",
    status: "COMPLETED",
    gitTag: "demo-fixed",
    summary: "All 5 demo checks passed in 12.4 seconds.",
    commit: "bd3e75e74c099b9fc4eba5504f91dcad4969b60e",
    reportHash: "7f4a28b991c1032a4e9b7f5d91c2b4a8e2f9d1c3a6b5e8c7d9a1b2c3d4e5f607",
    checks: [
      { name: "Repository resolved", outcome: "PASSED" },
      { name: "Skill selected", outcome: "PASSED" },
      { name: "Sandbox created", outcome: "PASSED" },
      { name: "Project built", outcome: "PASSED" },
      { name: "Unit tests", outcome: "PASSED" },
    ],
    ...common,
  },
  broken: {
    id: "broken",
    verdict: "FAIL",
    status: "COMPLETED",
    gitTag: "demo-broken",
    summary: "4 of 5 demo checks passed in 14.1 seconds. 1 reproducible code test failure found.",
    commit: "339a3effb97cac6073cd5cf8dab746eca25cd255",
    reportHash: "93d6e46a77e8d3ad6e0c6cacdbb81751a70f98c4a450c9c2540690766cf73b12",
    checks: [
      { name: "Repository resolved", outcome: "PASSED" },
      { name: "Skill selected", outcome: "PASSED" },
      { name: "Sandbox created", outcome: "PASSED" },
      { name: "Project built", outcome: "PASSED" },
      { name: "Unit tests", outcome: "FAILED" },
    ],
    ...common,
  },
  timeout: {
    id: "timeout",
    verdict: "INCONCLUSIVE",
    status: "TIMEOUT",
    gitTag: "demo-timeout",
    summary: "Execution timed out after 45,000 ms before completing all checks (infrastructure limit, not code failure).",
    commit: "e4861092d18fb5efd5168dc87dae0e2e81999da0",
    reportHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    checks: [
      { name: "Repository resolved", outcome: "PASSED" },
      { name: "Skill selected", outcome: "PASSED" },
      { name: "Sandbox created", outcome: "PASSED" },
      { name: "Project built", outcome: "PASSED" },
      { name: "Unit tests", outcome: "INCONCLUSIVE" },
    ],
    ...common,
  },
  "system-error": {
    id: "system-error",
    verdict: "INCONCLUSIVE",
    status: "SYSTEM_ERROR",
    gitTag: "demo-system-error",
    summary: "Runner daemon lost connection (RUNNER_DISCONNECTED, retryable infrastructure error — not code failure).",
    commit: "c4c92581f1e98acb0d6ed0e604005157bf72a184",
    reportHash: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
    systemError: {
      code: "RUNNER_DISCONNECTED",
      message: "The execution runner worker exited unexpectedly. This run can be safely retried.",
      retryable: true,
    },
    checks: [
      { name: "Repository resolved", outcome: "PASSED" },
      { name: "Skill selected", outcome: "PASSED" },
      { name: "Sandbox created", outcome: "INCONCLUSIVE" },
    ],
    ...common,
  },
  inconclusive: {
    id: "inconclusive",
    verdict: "INCONCLUSIVE",
    status: "COMPLETED",
    gitTag: "demo-inconclusive",
    summary: "Build succeeded but test framework output was ambiguous (UNSUPPORTED_TEST_FRAMEWORK).",
    commit: "731eb1a558d777ee1a105d9a2ffce6fb177522d3",
    reportHash: "f6e5d4c3b2a109876543210fedcba9876543210fedcba9876543210fedcba987",
    checks: [
      { name: "Repository resolved", outcome: "PASSED" },
      { name: "Skill selected", outcome: "PASSED" },
      { name: "Sandbox created", outcome: "PASSED" },
      { name: "Project built", outcome: "PASSED" },
      { name: "Unit tests", outcome: "INCONCLUSIVE" },
    ],
    ...common,
  },
}

export function getDemoKind(id: string | undefined, pathname: string): DemoKind {
  if (id === "timeout" || pathname.includes("/timeout")) return "timeout"

  if (id === "system-error" || id === "system_error" || pathname.includes("/system-error")) return "system-error"
  if (id === "inconclusive" || pathname.includes("/inconclusive")) return "inconclusive"
  if (id === "fail-demo" || id === "broken" || pathname.endsWith("/broken")) return "broken"

  return "passed"
}

export function isCanonicalGitHubRepository(value: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value)
}

export function isNonFailStatus(status: string, verdict: string | null): boolean {
  const isTimeout = status === "TIMEOUT"
  const isSystemError = status === "SYSTEM_ERROR"
  return verdict === "FAIL" && !isTimeout && !isSystemError
}
