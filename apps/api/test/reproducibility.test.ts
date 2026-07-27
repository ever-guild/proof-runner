import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  type VerifyRequest,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import { ReceiptSigner } from "@ever-guild/proof-runner-receipt";
import {
  compareReproducibilityReports,
  projectReproducibilityReport,
  ReproducibilityService,
} from "../src/reproducibility.js";
import { RunStore } from "../src/store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const request: VerifyRequest = {
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
};

const report = (
  runId: string,
  completedAt: string,
): VerificationReport => ({
  contractVersion: CONTRACT_VERSION,
  runId,
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha: "a".repeat(40),
  resolvedRef: { type: "branch", value: "main" },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  runtimeImageDigest: `sha256:${"c".repeat(64)}`,
  verdict: "PASS",
  checks: [
    {
      id: "test",
      stage: "TEST",
      title: "Run tests",
      outcome: "PASSED",
      startedAt: completedAt,
      completedAt,
      durationMs: 20,
      exitCode: 0,
      summary: "Passed.",
    },
    {
      id: "build",
      stage: "BUILD",
      title: "Run build",
      outcome: "PASSED",
      startedAt: completedAt,
      completedAt,
      durationMs: 10,
      exitCode: 0,
      summary: "Passed.",
    },
  ],
  artifacts: [
    { id: "z-output", sha256: "d".repeat(64) },
    { id: "a-output", sha256: "e".repeat(64) },
  ],
  durationMs: 30,
  completedAt,
  reasonCode: null,
});

describe("reproducibility comparison", () => {
  it("excludes run identity, timestamps, duration, and input ordering", () => {
    const baseline = report(
      "018f47ac-5d7b-7c20-a1aa-0242ac120001",
      "2026-07-26T12:00:00.000Z",
    );
    const candidate = {
      ...report(
        "018f47ac-5d7b-7c20-a1aa-0242ac120002",
        "2026-07-26T13:00:00.000Z",
      ),
      checks: [...baseline.checks].reverse().map((check) => ({
        ...check,
        startedAt: "2026-07-26T13:00:00.000Z",
        completedAt: "2026-07-26T13:00:01.000Z",
        durationMs: 999,
      })),
      artifacts: [...(baseline.artifacts ?? [])].reverse(),
      durationMs: 999,
    };

    expect(projectReproducibilityReport(candidate)).toEqual(
      projectReproducibilityReport(baseline),
    );
    expect(compareReproducibilityReports(baseline, candidate)).toMatchObject({
      consistent: true,
    });
    expect(
      compareReproducibilityReports(baseline, candidate).baselineHash,
    ).toBe(compareReproducibilityReports(baseline, candidate).candidateHash);
  });

  it("detects PASS/FAIL divergence and changed artifact hashes", () => {
    const baseline = report(
      "018f47ac-5d7b-7c20-a1aa-0242ac120001",
      "2026-07-26T12:00:00.000Z",
    );
    const failed: VerificationReport = {
      ...report(
        "018f47ac-5d7b-7c20-a1aa-0242ac120002",
        "2026-07-26T12:01:00.000Z",
      ),
      verdict: "FAIL",
      checks: baseline.checks.map((check) =>
        check.id === "test"
          ? { ...check, outcome: "FAILED", exitCode: 1 }
          : check,
      ),
      reasonCode: "TEST_FAILED",
    };
    expect(compareReproducibilityReports(baseline, failed)).toMatchObject({
      consistent: false,
      baseline: { verdict: "PASS" },
      candidate: { verdict: "FAIL" },
    });

    const changedArtifact = {
      ...baseline,
      runId: "018f47ac-5d7b-7c20-a1aa-0242ac120003",
      artifacts: [{ id: "a-output", sha256: "f".repeat(64) }],
    };
    expect(
      compareReproducibilityReports(baseline, changedArtifact).consistent,
    ).toBe(false);

    const changedRuntime = {
      ...baseline,
      runId: "018f47ac-5d7b-7c20-a1aa-0242ac120004",
      runtimeImageDigest: `sha256:${"f".repeat(64)}` as const,
    };
    expect(
      compareReproducibilityReports(baseline, changedRuntime).consistent,
    ).toBe(false);
  });

  it("publishes linked child receipts and an inconclusive nondeterministic result", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-repro-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const service = new ReproducibilityService(store);
    const { privateKey } = generateKeyPairSync("ed25519");
    const signer = new ReceiptSigner({
      keyId: "repro-test",
      privateKeyPem: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });

    try {
      const created = service.create("flaky-fixture", request);
      expect(created.kind).toBe("created");
      if (created.kind !== "created") throw new Error("expected creation");
      expect(created.reproducibility).toMatchObject({
        status: "QUEUED",
        comparison: null,
      });

      const baseline = store.claimNext();
      if (!baseline) throw new Error("expected baseline");
      const baselineReport = report(
        baseline.response.id,
        "2026-07-26T12:00:00.000Z",
      );
      expect(
        store.complete(
          baseline.response.id,
          "COMPLETED",
          baselineReport,
          signer.issue(baselineReport),
          "1".repeat(64),
        ),
      ).toBe(true);

      const candidate = store.claimNext();
      if (!candidate) throw new Error("expected candidate");
      const passingCandidate = report(
        candidate.response.id,
        "2026-07-26T12:01:00.000Z",
      );
      const candidateReport: VerificationReport = {
        ...passingCandidate,
        verdict: "FAIL",
        reasonCode: "TEST_FAILED",
        checks: passingCandidate.checks.map((check) =>
          check.id === "test"
            ? { ...check, outcome: "FAILED", exitCode: 1 }
            : check,
        ),
      };
      expect(
        store.complete(
          candidate.response.id,
          "COMPLETED",
          candidateReport,
          signer.issue(candidateReport),
          "2".repeat(64),
        ),
      ).toBe(true);

      expect(service.get(created.reproducibility.id)).toMatchObject({
        status: "INCONCLUSIVE",
        verdict: "INCONCLUSIVE",
        reasonCode: "NONDETERMINISTIC_RESULT",
        children: [
          {
            runId: baseline.response.id,
            verdict: "PASS",
            receipt: `/api/receipts/${baseline.response.id}`,
          },
          {
            runId: candidate.response.id,
            verdict: "FAIL",
            receipt: `/api/receipts/${candidate.response.id}`,
          },
        ],
        comparison: {
          consistent: false,
          baseline: { verdict: "PASS" },
          candidate: { verdict: "FAIL" },
        },
      });
    } finally {
      store.close();
    }
  });
});
