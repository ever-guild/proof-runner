import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComparisonResponseSchema,
  CONTRACT_VERSION,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import {
  ReceiptService,
  ReceiptStore,
  verifyReceipt,
} from "@ever-guild/proof-runner-receipt";
import {
  DEMO_BROKEN_SHA,
  DEMO_FIXED_SHA,
} from "@ever-guild/proof-runner-metadata";
import { InspectionService } from "../src/inspection.js";
import {
  Orchestrator,
  type RunnerClient,
} from "../src/orchestration.js";
import { createApiServer } from "../src/server.js";
import { RunStore } from "../src/store.js";
import {
  DEMO_BROKEN_SIGNED_RECEIPT,
  DEMO_COMPARISON_KEY_ID,
  DEMO_COMPARISON_PUBLIC_KEY_PEM,
  DEMO_FIXED_SIGNED_RECEIPT,
} from "./fixtures/demo-comparison-receipts.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const fixtureReport = (input: {
  runId: string;
  commitSha: string;
  verdict: "PASS" | "FAIL";
  repositoryUrl?: string;
}): VerificationReport => ({
  contractVersion: CONTRACT_VERSION,
  runId: input.runId,
  repositoryUrl:
    input.repositoryUrl ?? "https://github.com/ever-guild/example",
  resolvedCommitSha: input.commitSha,
  resolvedRef: { type: "commit", value: input.commitSha },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  runtimeImageDigest: `sha256:${"c".repeat(64)}`,
  verdict: input.verdict,
  checks: [
    {
      id: "test",
      stage: "TEST",
      title: "Run tests",
      outcome: input.verdict === "PASS" ? "PASSED" : "FAILED",
      startedAt: "2026-07-26T12:00:00.000Z",
      completedAt: "2026-07-26T12:00:01.000Z",
      durationMs: 1_000,
      exitCode: input.verdict === "PASS" ? 0 : 1,
      summary:
        input.verdict === "PASS" ? "Tests passed." : "Tests failed.",
    },
  ],
  durationMs: 1_000,
  completedAt: "2026-07-26T12:00:01.000Z",
  reasonCode: input.verdict === "PASS" ? null : "TEST_FAILED",
});

const idleRunner: RunnerClient = {
  dispatch: async () => undefined,
  cancel: async () => undefined,
};

describe("comparison API", () => {
  it("serves JSON comparisons by ID or hash at a stable share URL", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-compare-api-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const store = new RunStore(databasePath);
    const receiptStore = new ReceiptStore(databasePath);
    const { privateKey } = generateKeyPairSync("ed25519");
    const receipts = new ReceiptService(
      {
        keyId: "comparison-api-test",
        privateKeyPem: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      receiptStore,
    );
    const baseline = DEMO_BROKEN_SIGNED_RECEIPT;
    const candidate = DEMO_FIXED_SIGNED_RECEIPT;
    const demoVerificationKeys = [
      {
        keyId: DEMO_COMPARISON_KEY_ID,
        publicKeyPem: DEMO_COMPARISON_PUBLIC_KEY_PEM,
      },
    ];
    expect(verifyReceipt(baseline, demoVerificationKeys).valid).toBe(true);
    expect(verifyReceipt(candidate, demoVerificationKeys).valid).toBe(true);
    const immutableBaseline = JSON.stringify(baseline);
    const immutableCandidate = JSON.stringify(candidate);
    receiptStore.save(baseline, { isPublic: true });
    receiptStore.save(candidate, { isPublic: true });
    const incompatible = receipts.issue(
      fixtureReport({
        runId: "018f47ac-5d7b-7c20-a1aa-0242ac120203",
        commitSha: "3".repeat(40),
        verdict: "PASS",
        repositoryUrl: "https://github.com/ever-guild/other",
      }),
    );
    const orchestrator = new Orchestrator(store, idleRunner, receipts.signer);
    const server = createApiServer({
      store,
      inspection: new InspectionService(),
      orchestrator,
      bearerToken: "t".repeat(32),
      receipts,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("missing server address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/comparisons`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          baseline: { type: "run-id", value: baseline.payload.id },
          candidate: {
            type: "receipt-hash",
            value: candidate.payloadHash,
          },
        }),
      });
      expect(response.status).toBe(200);
      const comparison = ComparisonResponseSchema.parse(
        await response.json(),
      );
      expect(comparison).toMatchObject({
        baseline: {
          runId: baseline.payload.id,
          commitSha: DEMO_BROKEN_SHA,
          verdict: "FAIL",
          receipt: baseline,
        },
        candidate: {
          runId: candidate.payload.id,
          commitSha: DEMO_FIXED_SHA,
          verdict: "PASS",
          receipt: candidate,
        },
        checks: [
          {
            checkId: "build",
            classification: "UNCHANGED",
            baselineOutcome: "PASSED",
            candidateOutcome: "PASSED",
          },
          {
            checkId: "test",
            classification: "RESOLVED",
            baselineOutcome: "FAILED",
            candidateOutcome: "PASSED",
          },
        ],
        links: {
          ui: `/compare/${baseline.payload.id}/${candidate.payloadHash}`,
        },
      });

      const shared = await fetch(`${baseUrl}${comparison.links.self}`);
      expect(shared.status).toBe(200);
      await expect(shared.json()).resolves.toEqual(comparison);

      const missing = await fetch(
        `${baseUrl}/api/comparisons/${baseline.payload.id}/${"0".repeat(64)}`,
      );
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({
        error: { code: "COMPARISON_EVIDENCE_NOT_FOUND" },
      });

      const incompatibleResponse = await fetch(
        `${baseUrl}/api/comparisons/${baseline.payload.id}/${incompatible.payload.id}`,
      );
      expect(incompatibleResponse.status).toBe(422);
      await expect(incompatibleResponse.json()).resolves.toMatchObject({
        error: {
          code: "INCOMPATIBLE_EVIDENCE",
          details: {
            reasonCodes: expect.arrayContaining(["REPOSITORY_MISMATCH"]),
          },
        },
      });

      const malformed = await fetch(
        `${baseUrl}/api/comparisons/not-an-id/not-a-hash`,
      );
      expect(malformed.status).toBe(400);
      await expect(malformed.json()).resolves.toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
      expect(JSON.stringify(baseline)).toBe(immutableBaseline);
      expect(JSON.stringify(candidate)).toBe(immutableCandidate);
    } finally {
      orchestrator.stop();
      store.close();
      receiptStore.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
