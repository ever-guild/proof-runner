import type { RunResponse } from "./public.js";

const repositoryUrl = "https://github.com/ever-guild/proof-runner-demo";
const resolvedCommitSha = "1111111111111111111111111111111111111111";
const skillHash =
  "2222222222222222222222222222222222222222222222222222222222222222";
const runtimeImageDigest =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333";
const createdAt = "2026-07-23T10:00:00.000Z";
const completedAt = "2026-07-23T10:00:03.000Z";
const resolvedRef = { type: "tag" as const, value: "demo-fixed" };
const skill = {
  name: "node-typescript" as const,
  version: "1" as const,
  hash: skillHash,
};

function completedRun(
  id: string,
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE",
  outcome: "PASSED" | "FAILED" | "INCONCLUSIVE",
  reasonCode: string | null,
): RunResponse {
  return {
    contractVersion: "1.0",
    id,
    status: "COMPLETED",
    verdict,
    activeStage: null,
    queuePosition: null,
    createdAt,
    startedAt: "2026-07-23T10:00:01.000Z",
    completedAt,
    report: {
      contractVersion: "1.0",
      runId: id,
      repositoryUrl,
      resolvedCommitSha,
      resolvedRef,
      skill,
      runtimeImageDigest,
      verdict,
      checks: [
        {
          id: "test",
          stage: "TEST",
          title: "Run test suite",
          outcome,
          startedAt: "2026-07-23T10:00:02.000Z",
          completedAt,
          durationMs: 1_000,
          exitCode: outcome === "PASSED" ? 0 : outcome === "FAILED" ? 1 : null,
          summary:
            outcome === "PASSED"
              ? "All tests passed."
              : outcome === "FAILED"
                ? "One deterministic test failed."
                : "The registry was unavailable.",
        },
      ],
      durationMs: 2_000,
      completedAt,
      reasonCode,
    },
    links: {
      self: `/api/runs/${id}`,
      receipt: `/api/receipts/${id}`,
    },
    systemError: null,
  };
}

export const MOCK_PASS_RESPONSE = completedRun(
  "018f47ac-5d7b-7c20-a1aa-0242ac120001",
  "PASS",
  "PASSED",
  null,
);

export const MOCK_FAIL_RESPONSE = completedRun(
  "018f47ac-5d7b-7c20-a1aa-0242ac120002",
  "FAIL",
  "FAILED",
  "TEST_FAILED",
);

export const MOCK_INCONCLUSIVE_RESPONSE = completedRun(
  "018f47ac-5d7b-7c20-a1aa-0242ac120003",
  "INCONCLUSIVE",
  "INCONCLUSIVE",
  "REGISTRY_UNAVAILABLE",
);

export const MOCK_SYSTEM_ERROR_RESPONSE: RunResponse = {
  contractVersion: "1.0",
  id: "018f47ac-5d7b-7c20-a1aa-0242ac120004",
  status: "SYSTEM_ERROR",
  verdict: "INCONCLUSIVE",
  activeStage: null,
  queuePosition: null,
  createdAt,
  startedAt: "2026-07-23T10:00:01.000Z",
  completedAt,
  report: null,
  links: {
    self: "/api/runs/018f47ac-5d7b-7c20-a1aa-0242ac120004",
    receipt: null,
  },
  systemError: {
    code: "RUNNER_UNAVAILABLE",
    message: "The runner did not accept the dispatch.",
    retryable: true,
  },
};

export const MOCK_RUN_RESPONSES = {
  PASS: MOCK_PASS_RESPONSE,
  FAIL: MOCK_FAIL_RESPONSE,
  INCONCLUSIVE: MOCK_INCONCLUSIVE_RESPONSE,
  SYSTEM_ERROR: MOCK_SYSTEM_ERROR_RESPONSE,
} as const;
