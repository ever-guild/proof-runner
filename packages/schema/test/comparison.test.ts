import { describe, expect, it } from "vitest";
import {
  ComparisonRequestSchema,
  ComparisonResponseSchema,
  CONTRACT_VERSION,
  MOCK_FAIL_RESPONSE,
  MOCK_PASS_RESPONSE,
  PUBLIC_API_ROUTES,
} from "../src/index.js";

const receipt = (
  report: NonNullable<typeof MOCK_PASS_RESPONSE.report>,
  payloadHash: string,
) => ({
  contractVersion: CONTRACT_VERSION,
  payload: {
    contractVersion: CONTRACT_VERSION,
    id: report.runId,
    report,
    createdAt: report.completedAt,
  },
  canonicalization: "JCS-RFC8785",
  hashAlgorithm: "SHA-256",
  payloadHash,
  signatureAlgorithm: "Ed25519",
  keyId: "comparison-test",
  signature: `${"A".repeat(86)}==`,
} as const);

describe("verified commit comparison contracts", () => {
  it("accepts exactly two run IDs or receipt hashes", () => {
    expect(PUBLIC_API_ROUTES.compare).toEqual({
      method: "POST",
      path: "/api/comparisons",
    });
    expect(PUBLIC_API_ROUTES.comparison).toEqual({
      method: "GET",
      path: "/api/comparisons/:baseline/:candidate",
    });
    expect(
      ComparisonRequestSchema.parse({
        contractVersion: CONTRACT_VERSION,
        baseline: {
          type: "run-id",
          value: MOCK_FAIL_RESPONSE.id,
        },
        candidate: {
          type: "receipt-hash",
          value: "a".repeat(64),
        },
      }),
    ).toMatchObject({
      baseline: { type: "run-id" },
      candidate: { type: "receipt-hash" },
    });
    expect(
      ComparisonRequestSchema.safeParse({
        contractVersion: CONTRACT_VERSION,
        baseline: { type: "run-id", value: "../../../etc/passwd" },
        candidate: { type: "receipt-hash", value: "A".repeat(64) },
      }).success,
    ).toBe(false);
  });

  it("preserves both signed receipts and classifies check IDs", () => {
    const baselineReport = {
      ...MOCK_FAIL_RESPONSE.report!,
      checks: [
        ...MOCK_FAIL_RESPONSE.report!.checks,
        {
          ...MOCK_FAIL_RESPONSE.report!.checks[0]!,
          id: "removed",
          outcome: "PASSED" as const,
        },
      ],
    };
    const candidateReport = {
      ...MOCK_PASS_RESPONSE.report!,
      resolvedCommitSha: "4".repeat(40),
      checks: [
        ...MOCK_PASS_RESPONSE.report!.checks,
        {
          ...MOCK_PASS_RESPONSE.report!.checks[0]!,
          id: "added",
          outcome: "PASSED" as const,
        },
      ],
    };
    const baselineReceipt = receipt(baselineReport, "d".repeat(64));
    const candidateReceipt = receipt(candidateReport, "e".repeat(64));
    const parsed = ComparisonResponseSchema.parse({
      contractVersion: CONTRACT_VERSION,
      id: "f".repeat(64),
      baseline: {
        selector: { type: "run-id", value: baselineReport.runId },
        runId: baselineReport.runId,
        receiptHash: baselineReceipt.payloadHash,
        commitSha: baselineReport.resolvedCommitSha,
        verdict: baselineReport.verdict,
        receipt: baselineReceipt,
      },
      candidate: {
        selector: {
          type: "receipt-hash",
          value: candidateReceipt.payloadHash,
        },
        runId: candidateReport.runId,
        receiptHash: candidateReceipt.payloadHash,
        commitSha: candidateReport.resolvedCommitSha,
        verdict: candidateReport.verdict,
        receipt: candidateReceipt,
      },
      compatibility: {
        repositoryUrl: baselineReport.repositoryUrl,
        contractVersion: CONTRACT_VERSION,
        skill: baselineReport.skill,
        runtimeImageDigest: baselineReport.runtimeImageDigest,
        verificationContractHash: null,
      },
      checks: [
        {
          checkId: "added",
          classification: "ADDED",
          baselineOutcome: null,
          candidateOutcome: "PASSED",
        },
        {
          checkId: "removed",
          classification: "REMOVED",
          baselineOutcome: "PASSED",
          candidateOutcome: null,
        },
        {
          checkId: "test",
          classification: "RESOLVED",
          baselineOutcome: "FAILED",
          candidateOutcome: "PASSED",
        },
      ],
      driftLabels: [
        "VERDICT_DRIFT",
        "CHECK_SET_DRIFT",
        "CHECK_OUTCOME_DRIFT",
      ],
      links: {
        self: `/api/comparisons/${baselineReport.runId}/${candidateReceipt.payloadHash}`,
        ui: `/compare/${baselineReport.runId}/${candidateReceipt.payloadHash}`,
      },
    });

    expect(parsed.baseline.receipt).toEqual(baselineReceipt);
    expect(parsed.candidate.receipt).toEqual(candidateReceipt);
    expect(parsed.checks.map((check) => check.classification)).toEqual([
      "ADDED",
      "REMOVED",
      "RESOLVED",
    ]);
  });

  it("rejects evidence metadata that contradicts a signed receipt", () => {
    const baselineReport = MOCK_FAIL_RESPONSE.report!;
    const candidateReport = {
      ...MOCK_PASS_RESPONSE.report!,
      resolvedCommitSha: "4".repeat(40),
    };
    const baselineReceipt = receipt(baselineReport, "d".repeat(64));
    const candidateReceipt = receipt(candidateReport, "e".repeat(64));
    const response = {
      contractVersion: CONTRACT_VERSION,
      id: "f".repeat(64),
      baseline: {
        selector: { type: "run-id", value: baselineReport.runId },
        runId: baselineReport.runId,
        receiptHash: "0".repeat(64),
        commitSha: baselineReport.resolvedCommitSha,
        verdict: baselineReport.verdict,
        receipt: baselineReceipt,
      },
      candidate: {
        selector: { type: "run-id", value: candidateReport.runId },
        runId: candidateReport.runId,
        receiptHash: candidateReceipt.payloadHash,
        commitSha: candidateReport.resolvedCommitSha,
        verdict: candidateReport.verdict,
        receipt: candidateReceipt,
      },
      compatibility: {
        repositoryUrl: baselineReport.repositoryUrl,
        contractVersion: CONTRACT_VERSION,
        skill: baselineReport.skill,
        runtimeImageDigest: baselineReport.runtimeImageDigest,
        verificationContractHash: null,
      },
      checks: [],
      driftLabels: [],
      links: {
        self: "/api/comparisons/a/b",
        ui: "/compare/a/b",
      },
    };
    expect(ComparisonResponseSchema.safeParse(response).success).toBe(false);
  });
});
