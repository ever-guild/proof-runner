import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  type ComparisonRequest,
  type SignedReceipt,
  type VerificationContract,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import {
  ReceiptSigner,
  verifyReceipt,
  type StoredReceipt,
} from "@ever-guild/proof-runner-receipt";
import {
  DEMO_BROKEN_SHA,
  DEMO_FIXED_SHA,
} from "@ever-guild/proof-runner-metadata";
import {
  ComparisonCompatibilityError,
  ComparisonEvidenceNotFoundError,
  ComparisonService,
  compareVerifiedReceipts,
} from "../src/comparison.js";
import {
  DEMO_BROKEN_SIGNED_RECEIPT,
  DEMO_COMPARISON_KEY_ID,
  DEMO_COMPARISON_PUBLIC_KEY_PEM,
  DEMO_FIXED_SIGNED_RECEIPT,
} from "./fixtures/demo-comparison-receipts.js";

const { privateKey } = generateKeyPairSync("ed25519");
const signer = new ReceiptSigner({
  keyId: "comparison-test",
  privateKeyPem: privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
});

const check = (
  id: string,
  outcome: "PASSED" | "FAILED",
): VerificationReport["checks"][number] => ({
  id,
  stage: id === "build" ? "BUILD" : "TEST",
  title: id,
  outcome,
  startedAt: "2026-07-26T12:00:00.000Z",
  completedAt: "2026-07-26T12:00:01.000Z",
  durationMs: 1_000,
  exitCode: outcome === "PASSED" ? 0 : 1,
  summary: `${id} ${outcome.toLowerCase()}.`,
});

const report = (input: {
  runId: string;
  commit: string;
  verdict: "PASS" | "FAIL";
  checks: VerificationReport["checks"];
  repositoryUrl?: string;
  skillHash?: string;
  runtimeImageDigest?: string;
}): VerificationReport => ({
  contractVersion: CONTRACT_VERSION,
  runId: input.runId,
  repositoryUrl:
    input.repositoryUrl ?? "https://github.com/ever-guild/example",
  resolvedCommitSha: input.commit,
  resolvedRef: { type: "commit", value: input.commit },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: input.skillHash ?? "b".repeat(64),
  },
  runtimeImageDigest:
    input.runtimeImageDigest ?? `sha256:${"c".repeat(64)}`,
  verdict: input.verdict,
  checks: input.checks,
  artifacts: [{ id: "dist", sha256: "d".repeat(64) }],
  durationMs: 1_000,
  completedAt: "2026-07-26T12:00:01.000Z",
  reasonCode: input.verdict === "PASS" ? null : "TEST_FAILED",
});

const baselineReport = report({
  runId: "018f47ac-5d7b-7c20-a1aa-0242ac120101",
  commit: "1".repeat(40),
  verdict: "FAIL",
  checks: [
    check("build", "PASSED"),
    check("removed", "PASSED"),
    check("test", "FAILED"),
  ],
});
const candidateReport = report({
  runId: "018f47ac-5d7b-7c20-a1aa-0242ac120102",
  commit: "2".repeat(40),
  verdict: "PASS",
  checks: [
    check("added", "PASSED"),
    check("build", "PASSED"),
    check("test", "PASSED"),
  ],
});
const baselineReceipt = signer.issue(baselineReport);
const candidateReceipt = signer.issue(candidateReport);

const verificationContract = (
  source: VerificationReport,
  required = true,
): VerificationContract => ({
  version: "1",
  subject: {
    repositoryUrl: source.repositoryUrl,
    resolvedCommitSha: source.resolvedCommitSha,
    skillHash: source.skill.hash,
    runtimeImageDigest: source.runtimeImageDigest,
  },
  criteria: [{ id: "tests", kind: "test-suite", required }],
  prohibitions: [],
});

const stored = (receipt: SignedReceipt): StoredReceipt => ({
  receipt,
  isPublic: true,
});

const request: ComparisonRequest = {
  contractVersion: CONTRACT_VERSION,
  baseline: { type: "run-id", value: baselineReport.runId },
  candidate: {
    type: "receipt-hash",
    value: candidateReceipt.payloadHash,
  },
};

describe("verified receipt comparison", () => {
  it("compares immutable signed demo broken/fixed receipts at their real commits", () => {
    const verificationKeys = [
      {
        keyId: DEMO_COMPARISON_KEY_ID,
        publicKeyPem: DEMO_COMPARISON_PUBLIC_KEY_PEM,
      },
    ];
    expect(
      verifyReceipt(DEMO_BROKEN_SIGNED_RECEIPT, verificationKeys),
    ).toMatchObject({ valid: true, reason: null });
    expect(
      verifyReceipt(DEMO_FIXED_SIGNED_RECEIPT, verificationKeys),
    ).toMatchObject({ valid: true, reason: null });
    expect(Object.isFrozen(DEMO_BROKEN_SIGNED_RECEIPT)).toBe(true);
    expect(Object.isFrozen(DEMO_FIXED_SIGNED_RECEIPT)).toBe(true);

    const comparison = compareVerifiedReceipts({
      request: {
        contractVersion: CONTRACT_VERSION,
        baseline: {
          type: "run-id",
          value: DEMO_BROKEN_SIGNED_RECEIPT.payload.id,
        },
        candidate: {
          type: "receipt-hash",
          value: DEMO_FIXED_SIGNED_RECEIPT.payloadHash,
        },
      },
      baselineReceipt: DEMO_BROKEN_SIGNED_RECEIPT,
      candidateReceipt: DEMO_FIXED_SIGNED_RECEIPT,
    });

    expect(comparison.baseline.commitSha).toBe(DEMO_BROKEN_SHA);
    expect(comparison.candidate.commitSha).toBe(DEMO_FIXED_SHA);
    expect(comparison.checks).toContainEqual({
      checkId: "test",
      classification: "RESOLVED",
      baselineOutcome: "FAILED",
      candidateOutcome: "PASSED",
    });
    expect(comparison).not.toHaveProperty("patch");
    expect(comparison).not.toHaveProperty("fix");
  });

  it("classifies a broken/fixed pair without network or patch generation", () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("comparison must not use the network"));
    const beforeBaseline = JSON.stringify(baselineReceipt);
    const beforeCandidate = JSON.stringify(candidateReceipt);

    try {
      const comparison = compareVerifiedReceipts({
        request,
        baselineReceipt,
        candidateReceipt,
      });
      expect(comparison.checks).toEqual([
        {
          checkId: "added",
          classification: "ADDED",
          baselineOutcome: null,
          candidateOutcome: "PASSED",
        },
        {
          checkId: "build",
          classification: "UNCHANGED",
          baselineOutcome: "PASSED",
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
      ]);
      expect(comparison.driftLabels).toEqual([
        "VERDICT_DRIFT",
        "CHECK_SET_DRIFT",
        "CHECK_OUTCOME_DRIFT",
      ]);
      expect(comparison.baseline.verdict).toBe("FAIL");
      expect(comparison.candidate.verdict).toBe("PASS");
      expect(JSON.stringify(comparison.baseline.receipt)).toBe(beforeBaseline);
      expect(JSON.stringify(comparison.candidate.receipt)).toBe(
        beforeCandidate,
      );
      expect(comparison).not.toHaveProperty("patch");
      expect(comparison).not.toHaveProperty("fix");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("resolves either run IDs or receipt hashes", () => {
    const byId = new Map([
      [baselineReceipt.payload.id, stored(baselineReceipt)],
      [candidateReceipt.payload.id, stored(candidateReceipt)],
    ]);
    const byHash = new Map([
      [baselineReceipt.payloadHash, stored(baselineReceipt)],
      [candidateReceipt.payloadHash, stored(candidateReceipt)],
    ]);
    const service = new ComparisonService({
      get: (id) => byId.get(id) ?? null,
      getByPayloadHash: (hash) => byHash.get(hash) ?? null,
    });

    expect(service.compare(request)).toMatchObject({
      baseline: { runId: baselineReport.runId },
      candidate: { runId: candidateReport.runId },
    });
    expect(() =>
      service.compare({
        ...request,
        baseline: {
          type: "run-id",
          value: "018f47ac-5d7b-7c20-a1aa-0242ac120199",
        },
      }),
    ).toThrow(ComparisonEvidenceNotFoundError);
  });

  it("requires compatible persisted verification contracts across commits", () => {
    const baselineContract = verificationContract(baselineReport);
    const candidateContract = verificationContract(candidateReport);
    expect(
      compareVerifiedReceipts({
        request,
        baselineReceipt,
        candidateReceipt,
        baselineContract,
        candidateContract,
      }).compatibility.verificationContractHash,
    ).toMatch(/^[a-f0-9]{64}$/);

    expect(() =>
      compareVerifiedReceipts({
        request,
        baselineReceipt,
        candidateReceipt,
        baselineContract,
        candidateContract: verificationContract(candidateReport, false),
      }),
    ).toThrowError(
      expect.objectContaining({
        reasonCodes: expect.arrayContaining(["CONTRACT_MISMATCH"]),
      }),
    );
  });

  it.each([
    {
      name: "repository",
      report: report({
        ...candidateReport,
        runId: "018f47ac-5d7b-7c20-a1aa-0242ac120111",
        commit: "3".repeat(40),
        verdict: "PASS",
        checks: candidateReport.checks,
        repositoryUrl: "https://github.com/ever-guild/other",
      }),
      reason: "REPOSITORY_MISMATCH",
    },
    {
      name: "skill",
      report: report({
        ...candidateReport,
        runId: "018f47ac-5d7b-7c20-a1aa-0242ac120112",
        commit: "3".repeat(40),
        verdict: "PASS",
        checks: candidateReport.checks,
        skillHash: "e".repeat(64),
      }),
      reason: "SKILL_MISMATCH",
    },
    {
      name: "runtime",
      report: report({
        ...candidateReport,
        runId: "018f47ac-5d7b-7c20-a1aa-0242ac120113",
        commit: "3".repeat(40),
        verdict: "PASS",
        checks: candidateReport.checks,
        runtimeImageDigest: `sha256:${"f".repeat(64)}`,
      }),
      reason: "RUNTIME_MISMATCH",
    },
  ])("rejects $name drift before comparing outcomes", ({ report, reason }) => {
    const incompatibleReceipt = signer.issue(report);
    try {
      compareVerifiedReceipts({
        request,
        baselineReceipt,
        candidateReceipt: incompatibleReceipt,
      });
      throw new Error("expected incompatible evidence");
    } catch (error) {
      expect(error).toBeInstanceOf(ComparisonCompatibilityError);
      expect((error as ComparisonCompatibilityError).reasonCodes).toContain(
        reason,
      );
    }
  });

  it("classifies SKIPPED as non-passing evidence correctly across check outcome transitions", () => {
    const makeCheckReport = (
      runId: string,
      outcomes: Record<string, "PASSED" | "FAILED" | "INCONCLUSIVE" | "SKIPPED">,
    ) => {
      const hasFailure = Object.values(outcomes).some(
        (outcome) => outcome === "FAILED" || outcome === "INCONCLUSIVE",
      );
      return report({
        runId,
        commit: "a".repeat(40),
        verdict: hasFailure ? "FAIL" : "PASS",
        checks: Object.entries(outcomes).map(([id, outcome]) => ({
          id,
          stage: "TEST",
          title: id,
          outcome,
          startedAt: "2026-07-26T12:00:00.000Z",
          completedAt: "2026-07-26T12:00:01.000Z",
          durationMs: 1_000,
          exitCode: outcome === "PASSED" ? 0 : 1,
          summary: `${id} ${outcome.toLowerCase()}.`,
        })),
      });
    };

    const leftReceipt = signer.issue(
      makeCheckReport("018f47ac-5d7b-7c20-a1aa-0242ac120201", {
        failedToSkipped: "FAILED",
        inconclusiveToSkipped: "INCONCLUSIVE",
        passedToSkipped: "PASSED",
        failedToPassed: "FAILED",
        inconclusiveToPassed: "INCONCLUSIVE",
        skippedToPassed: "SKIPPED",
        skippedToFailed: "SKIPPED",
        skippedToInconclusive: "SKIPPED",
      }),
    );
    const rightReceipt = signer.issue(
      makeCheckReport("018f47ac-5d7b-7c20-a1aa-0242ac120202", {
        failedToSkipped: "SKIPPED",
        inconclusiveToSkipped: "SKIPPED",
        passedToSkipped: "SKIPPED",
        failedToPassed: "PASSED",
        inconclusiveToPassed: "PASSED",
        skippedToPassed: "PASSED",
        skippedToFailed: "FAILED",
        skippedToInconclusive: "INCONCLUSIVE",
      }),
    );

    const comparison = compareVerifiedReceipts({
      request: {
        contractVersion: CONTRACT_VERSION,
        baseline: { type: "run-id", value: leftReceipt.payload.id },
        candidate: { type: "run-id", value: rightReceipt.payload.id },
      },
      baselineReceipt: leftReceipt,
      candidateReceipt: rightReceipt,
    });

    const checkMap = new Map(
      comparison.checks.map((c) => [c.checkId, c.classification]),
    );

    expect(checkMap.get("failedToSkipped")).toBe("UNCHANGED");
    expect(checkMap.get("inconclusiveToSkipped")).toBe("UNCHANGED");
    expect(checkMap.get("passedToSkipped")).toBe("NEW");
    expect(checkMap.get("failedToPassed")).toBe("RESOLVED");
    expect(checkMap.get("inconclusiveToPassed")).toBe("RESOLVED");
    expect(checkMap.get("skippedToPassed")).toBe("RESOLVED");
    expect(checkMap.get("skippedToFailed")).toBe("UNCHANGED");
    expect(checkMap.get("skippedToInconclusive")).toBe("UNCHANGED");
  });
});
