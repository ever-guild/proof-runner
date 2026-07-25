export const DEMO_REPOSITORY_URL = "https://github.com/ever-guild/proof-runner-demo";
export const DEMO_REPOSITORY = "ever-guild/proof-runner-demo";
export const DEMO_BROKEN_TAG = "demo-broken";
export const DEMO_FIXED_TAG = "demo-fixed";
export const DEMO_BROKEN_SHA = "504e54eae8440fb52579b805c107cfa814102003";
export const DEMO_FIXED_SHA = "73b14d731d858742a50907bdba3b99e09a417e35";

export const DEMO_KINDS = [
  "passed",
  "broken",
  "timeout",
  "system-error",
  "inconclusive",
] as const;

export type DemoKind = (typeof DEMO_KINDS)[number];
export type DemoCheckOutcome = "PASSED" | "FAILED" | "INCONCLUSIVE" | "TIMEOUT" | "SYSTEM_ERROR";
export type DemoDisplayVerdict = "PASS" | "FAIL" | "TIMEOUT" | "SYSTEM_ERROR" | "INCONCLUSIVE";

interface BaseDemoReceipt {
  id: DemoKind;
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  status: "COMPLETED" | "TIMEOUT" | "SYSTEM_ERROR";
  summary: string;
  skill: string;
  checks: Array<{ name: string; outcome: DemoCheckOutcome }>;
}

export interface PinnedDemoReceipt extends BaseDemoReceipt {
  source: "pinned-reference";
  provenance: {
    repository: string;
    gitTag: string;
    commit: string;
  };
}

export interface SimulatedDemoReceipt extends BaseDemoReceipt {
  source: "simulated";
  simulationNote: string;
  systemError?: { code: string; message: string; retryable: boolean };
  provenance?: never;
}

export type DemoReceipt = PinnedDemoReceipt | SimulatedDemoReceipt;

export const isDemoKind = (value: string): value is DemoKind =>
  (DEMO_KINDS as readonly string[]).includes(value);

const sampleSkill = "node-typescript@1";

export const demoReceipts = {
  passed: {
    id: "passed",
    source: "pinned-reference",
    verdict: "PASS",
    status: "COMPLETED",
    summary: "Static demo reference for a passing source revision. No ProofRunner execution was recorded.",
    skill: sampleSkill,
    provenance: {
      repository: DEMO_REPOSITORY,
      gitTag: DEMO_FIXED_TAG,
      commit: DEMO_FIXED_SHA,
    },
    checks: [
      { name: "Public source reference", outcome: "PASSED" },
      { name: "Skill selected", outcome: "PASSED" },
      { name: "Static build example", outcome: "PASSED" },
      { name: "Unit tests", outcome: "PASSED" },
    ],
  },
  broken: {
    id: "broken",
    source: "pinned-reference",
    verdict: "FAIL",
    status: "COMPLETED",
    summary: "Static demo reference for a reproducible code-test failure. No ProofRunner execution was recorded.",
    skill: sampleSkill,
    provenance: {
      repository: DEMO_REPOSITORY,
      gitTag: DEMO_BROKEN_TAG,
      commit: DEMO_BROKEN_SHA,
    },
    checks: [
      { name: "Public source reference", outcome: "PASSED" },
      { name: "Skill selected", outcome: "PASSED" },
      { name: "Static build example", outcome: "PASSED" },
      { name: "Unit tests", outcome: "FAILED" },
    ],
  },
  timeout: {
    id: "timeout",
    source: "simulated",
    verdict: "INCONCLUSIVE",
    status: "TIMEOUT",
    summary: "Simulated execution limit reached before all checks completed. Not a code failure.",
    simulationNote: "No repository execution or signed receipt was issued for this simulated example.",
    skill: sampleSkill,
    checks: [
      { name: "Demo state selected", outcome: "PASSED" },
      { name: "Execution-limit scenario", outcome: "TIMEOUT" },
    ],
  },
  "system-error": {
    id: "system-error",
    source: "simulated",
    verdict: "INCONCLUSIVE",
    status: "SYSTEM_ERROR",
    summary: "Simulated runner connection loss. Not a code failure.",
    simulationNote: "No repository execution or signed receipt was issued for this simulated example.",
    skill: sampleSkill,
    systemError: {
      code: "RUNNER_DISCONNECTED",
      message: "The simulated runner worker lost its connection. A real execution can be retried.",
      retryable: true,
    },
    checks: [
      { name: "Demo state selected", outcome: "PASSED" },
      { name: "Runner connection scenario", outcome: "SYSTEM_ERROR" },
    ],
  },
  inconclusive: {
    id: "inconclusive",
    source: "simulated",
    verdict: "INCONCLUSIVE",
    status: "COMPLETED",
    summary: "Simulated ambiguous test output. No code-failure verdict was issued.",
    simulationNote: "No repository execution or signed receipt was issued for this simulated example.",
    skill: sampleSkill,
    checks: [
      { name: "Demo state selected", outcome: "PASSED" },
      { name: "Result classification scenario", outcome: "INCONCLUSIVE" },
    ],
  },
} satisfies Record<DemoKind, DemoReceipt>;

export const isPinnedDemoReceipt = (receipt: DemoReceipt): receipt is PinnedDemoReceipt =>
  receipt.source === "pinned-reference";

export const getDemoKind = (id: string | undefined, pathname: string): DemoKind => {
  if (id === "timeout" || pathname.includes("/timeout")) return "timeout";
  if (id === "system-error" || id === "system_error" || pathname.includes("/system-error")) {
    return "system-error";
  }
  if (id === "inconclusive" || pathname.includes("/inconclusive")) return "inconclusive";
  if (id === "fail-demo" || id === "broken" || pathname.endsWith("/broken")) return "broken";
  return "passed";
};

export const getDemoReceiptDisplayVerdict = (receipt: DemoReceipt): DemoDisplayVerdict => {
  if (receipt.status === "TIMEOUT") return "TIMEOUT";
  if (receipt.status === "SYSTEM_ERROR") return "SYSTEM_ERROR";
  return receipt.verdict;
};

export interface DemoOpenGraphMetadata {
  title: string;
  description: string;
}

export const getDemoReceiptOpenGraphMetadata = (kind: DemoKind): DemoOpenGraphMetadata => {
  const receipt = demoReceipts[kind];
  const displayVerdict = getDemoReceiptDisplayVerdict(receipt);
  if (isPinnedDemoReceipt(receipt)) {
    return {
      title: `[DEMO] ${displayVerdict} Source Reference (${receipt.provenance.gitTag}) · ProofRunner`,
      description: `Static demo reference for ${receipt.provenance.repository} at tag ${receipt.provenance.gitTag}. No ProofRunner execution or signed receipt was issued.`,
    };
  }

  switch (kind) {
    case "timeout":
      return {
        title: "[DEMO] TIMEOUT Simulation · ProofRunner",
        description: "Simulated execution-limit example. No repository execution or signed receipt was issued.",
      };
    case "system-error":
      return {
        title: "[DEMO] SYSTEM_ERROR Simulation · ProofRunner",
        description: "Simulated runner-error example. No repository execution or signed receipt was issued.",
      };
    case "inconclusive":
      return {
        title: "[DEMO] INCONCLUSIVE Simulation · ProofRunner",
        description: "Simulated incomplete-result example. No repository execution or signed receipt was issued.",
      };
    case "passed":
    case "broken":
      throw new Error(`Pinned demo metadata expected for ${kind}`);
  }
};

export const getDemoProgressLabel = (completedStages: number, totalStages: number): string => {
  const boundedTotal = Math.max(0, totalStages);
  const boundedCompleted = Math.min(Math.max(0, completedStages), boundedTotal);
  return `Demo progress: ${boundedCompleted} of ${boundedTotal} stages`;
};
