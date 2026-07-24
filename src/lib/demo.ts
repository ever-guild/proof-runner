export type DemoKind = "passed" | "broken"

export interface DemoReceipt {
  id: DemoKind
  verdict: "PASS" | "FAIL"
  summary: string
  repository: string
  commit: string
  skill: string
  reportHash: string
  checks: Array<{ name: string; outcome: "PASSED" | "FAILED" }>
}

const common = {
  repository: "ever-guild/proof-runner",
  skill: "node-typescript@1",
}

export const demoReceipts: Record<DemoKind, DemoReceipt> = {
  passed: {
    id: "passed",
    verdict: "PASS",
    summary: "All 5 demo checks passed.",
    commit: "4c82fa189cb846189ff7224519a8497aeb78195d",
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
    summary: "4 of 5 demo checks passed. 1 reproducible failure found.",
    commit: "91bd7a2f7dd6537202dfaa5bdd6a2b35b06a1670",
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
}

export function getDemoKind(id: string | undefined, pathname: string): DemoKind {
  if (id === "fail-demo" || id === "broken" || pathname.endsWith("/broken")) {
    return "broken"
  }

  return "passed"
}

export function isCanonicalGitHubRepository(value: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value)
}
