import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  PUBLIC_API_ROUTES,
  ReproducibilityResponseSchema,
  ReproducibilityRequestSchema,
  VerificationReportSchema,
} from "../src/index.js";

const verifyRequest = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha: "a".repeat(40),
  resolvedRef: { type: "branch", value: "main" },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  public: false,
} as const;

describe("reproducibility contracts", () => {
  it("defines an idempotent asynchronous request without changing /api/verify", () => {
    expect(PUBLIC_API_ROUTES.reproducibility).toEqual({
      method: "POST",
      path: "/api/reproducibility",
    });
    expect(PUBLIC_API_ROUTES.reproducibilityResult).toEqual({
      method: "GET",
      path: "/api/reproducibility/:id",
    });
    expect(ReproducibilityRequestSchema.parse(verifyRequest)).toEqual(
      verifyRequest,
    );
    expect(
      ReproducibilityRequestSchema.safeParse({
        ...verifyRequest,
        repositoryUrl: "https://evil.example/repository",
      }).success,
    ).toBe(false);
  });

  it("publishes semantic projections, hashes, and both child receipt links", () => {
    const baseline = {
      runtimeImageDigest: `sha256:${"f".repeat(64)}`,
      verdict: "PASS",
      reasonCode: null,
      checks: [{ id: "test", outcome: "PASSED" }],
      artifacts: [{ id: "coverage", sha256: "c".repeat(64) }],
    } as const;
    const candidate = {
      ...baseline,
      verdict: "FAIL",
      checks: [{ id: "test", outcome: "FAILED" }],
    } as const;

    expect(
      ReproducibilityResponseSchema.parse({
        contractVersion: CONTRACT_VERSION,
        id: "018f47ac-5d7b-7c20-a1aa-0242ac120010",
        status: "INCONCLUSIVE",
        verdict: "INCONCLUSIVE",
        reasonCode: "NONDETERMINISTIC_RESULT",
        createdAt: "2026-07-26T12:00:00.000Z",
        children: [
          {
            runId: "018f47ac-5d7b-7c20-a1aa-0242ac120011",
            status: "COMPLETED",
            verdict: "PASS",
            receipt:
              "/api/receipts/018f47ac-5d7b-7c20-a1aa-0242ac120011",
          },
          {
            runId: "018f47ac-5d7b-7c20-a1aa-0242ac120012",
            status: "COMPLETED",
            verdict: "FAIL",
            receipt:
              "/api/receipts/018f47ac-5d7b-7c20-a1aa-0242ac120012",
          },
        ],
        comparison: {
          consistent: false,
          baseline,
          candidate,
          baselineHash: "d".repeat(64),
          candidateHash: "e".repeat(64),
        },
        links: {
          self:
            "/api/reproducibility/018f47ac-5d7b-7c20-a1aa-0242ac120010",
        },
      }).reasonCode,
    ).toBe("NONDETERMINISTIC_RESULT");
  });

  it("allows deterministic artifact hashes without changing existing reports", () => {
    const report = {
      contractVersion: CONTRACT_VERSION,
      runId: "018f47ac-5d7b-7c20-a1aa-0242ac120001",
      repositoryUrl: verifyRequest.repositoryUrl,
      resolvedCommitSha: verifyRequest.resolvedCommitSha,
      resolvedRef: verifyRequest.resolvedRef,
      skill: verifyRequest.skill,
      runtimeImageDigest: `sha256:${"c".repeat(64)}`,
      verdict: "PASS",
      checks: [
        {
          id: "test",
          stage: "TEST",
          title: "Run tests",
          outcome: "PASSED",
          startedAt: null,
          completedAt: null,
          durationMs: 0,
          exitCode: 0,
          summary: "Passed.",
        },
      ],
      artifacts: [{ id: "coverage", sha256: "d".repeat(64) }],
      durationMs: 0,
      completedAt: "2026-07-26T12:00:00.000Z",
      reasonCode: null,
    } as const;
    expect(VerificationReportSchema.parse(report)).toEqual(report);
    const { artifacts, ...legacyReport } = report;
    expect(artifacts).toHaveLength(1);
    expect(VerificationReportSchema.parse(legacyReport)).toEqual(legacyReport);
  });
});
