import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  ReproducibilityCreationResponseSchema,
  ReproducibilityResponseSchema,
  type InternalDispatchRequest,
  type VerificationReport,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import {
  ReceiptService,
  ReceiptStore,
} from "@ever-guild/proof-runner-receipt";
import {
  InspectionService,
  type InspectionGateway,
} from "../src/inspection.js";
import {
  Orchestrator,
  type RunnerClient,
} from "../src/orchestration.js";
import { createApiServer } from "../src/server.js";
import { RunStore } from "../src/store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const request: VerifyRequest = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl: "https://github.com/ever-guild/flaky-fixture",
  resolvedCommitSha: "a".repeat(40),
  resolvedRef: { type: "commit", value: "a".repeat(40) },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  public: false,
};

const inspectionGateway: InspectionGateway = {
  resolve: async () => request.resolvedCommitSha,
  file: async () => null,
};

class RecordingRunner implements RunnerClient {
  readonly dispatched: InternalDispatchRequest[] = [];

  async dispatch(run: InternalDispatchRequest): Promise<void> {
    this.dispatched.push(run);
  }

  async cancel(): Promise<void> {}
}

const report = (
  runId: string,
  verdict: "PASS" | "FAIL",
): VerificationReport => {
  const completedAt = new Date().toISOString();
  return {
    contractVersion: CONTRACT_VERSION,
    runId,
    repositoryUrl: request.repositoryUrl,
    resolvedCommitSha: request.resolvedCommitSha,
    resolvedRef: request.resolvedRef,
    skill: request.skill,
    runtimeImageDigest: `sha256:${"c".repeat(64)}`,
    verdict,
    checks: [
      {
        id: "build",
        stage: "BUILD",
        title: "Run build",
        outcome: "PASSED",
        startedAt: completedAt,
        completedAt,
        durationMs: 1,
        exitCode: 0,
        summary: "Build passed.",
      },
      {
        id: "test",
        stage: "TEST",
        title: "Run tests",
        outcome: verdict === "PASS" ? "PASSED" : "FAILED",
        startedAt: completedAt,
        completedAt,
        durationMs: 1,
        exitCode: verdict === "PASS" ? 0 : 1,
        summary: verdict === "PASS" ? "Tests passed." : "Flaky test failed.",
      },
    ],
    artifacts: [
      {
        id: "dist",
        sha256: verdict === "PASS" ? "d".repeat(64) : "e".repeat(64),
      },
    ],
    durationMs: 2,
    completedAt,
    reasonCode: verdict === "PASS" ? null : "TEST_FAILED",
  };
};

const sendJson = (
  baseUrl: string,
  path: string,
  method: "POST" | "PUT",
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("reproducibility API", () => {
  it("runs the same request sequentially and publishes nondeterministic evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-repro-api-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const store = new RunStore(databasePath);
    const receiptStore = new ReceiptStore(databasePath);
    const { privateKey } = generateKeyPairSync("ed25519");
    const receipts = new ReceiptService(
      {
        keyId: "repro-api-test",
        privateKeyPem: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      receiptStore,
    );
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts.signer);
    const bearerToken = "t".repeat(32);
    const server = createApiServer({
      store,
      inspection: new InspectionService(inspectionGateway),
      orchestrator,
      bearerToken,
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
      const missingKey = await sendJson(
        baseUrl,
        "/api/reproducibility",
        "POST",
        request,
      );
      expect(missingKey.status).toBe(400);
      await expect(missingKey.json()).resolves.toMatchObject({
        error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
      });

      const created = await sendJson(
        baseUrl,
        "/api/reproducibility",
        "POST",
        request,
        { "idempotency-key": "controlled-flaky-fixture" },
      );
      expect(created.status).toBe(202);
      const createdBody = ReproducibilityCreationResponseSchema.parse(
        await created.json(),
      );
      expect(createdBody).toMatchObject({
        replayed: false,
        reproducibility: {
          status: "RUNNING",
          children: [{ status: "RUNNING" }, { status: "QUEUED" }],
        },
      });
      expect(runner.dispatched).toHaveLength(1);
      expect(runner.dispatched[0]?.runId).toBe(
        createdBody.reproducibility.children[0].runId,
      );

      const replay = await sendJson(
        baseUrl,
        "/api/reproducibility",
        "POST",
        request,
        { "idempotency-key": "controlled-flaky-fixture" },
      );
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({
        replayed: true,
        reproducibility: { id: createdBody.reproducibility.id },
      });

      const conflict = await sendJson(
        baseUrl,
        "/api/reproducibility",
        "POST",
        { ...request, public: true },
        { "idempotency-key": "controlled-flaky-fixture" },
      );
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({
        error: { code: "IDEMPOTENCY_KEY_CONFLICT" },
      });

      const baselineDispatch = runner.dispatched[0]!;
      const baselineReport = report(baselineDispatch.runId, "PASS");
      const baselineResult = await sendJson(
        baseUrl,
        `/internal/v1/runs/${baselineDispatch.runId}/result`,
        "PUT",
        {
          contractVersion: CONTRACT_VERSION,
          leaseId: baselineDispatch.lease.leaseId,
          completedAt: baselineReport.completedAt,
          status: "COMPLETED",
          report: baselineReport,
          systemError: null,
        },
        { authorization: `Bearer ${bearerToken}` },
      );
      expect(baselineResult.status).toBe(200);
      expect(runner.dispatched).toHaveLength(2);

      const candidateDispatch = runner.dispatched[1]!;
      expect(candidateDispatch.runId).toBe(
        createdBody.reproducibility.children[1].runId,
      );
      const candidateReport = report(candidateDispatch.runId, "FAIL");
      const candidateResult = await sendJson(
        baseUrl,
        `/internal/v1/runs/${candidateDispatch.runId}/result`,
        "PUT",
        {
          contractVersion: CONTRACT_VERSION,
          leaseId: candidateDispatch.lease.leaseId,
          completedAt: candidateReport.completedAt,
          status: "COMPLETED",
          report: candidateReport,
          systemError: null,
        },
        { authorization: `Bearer ${bearerToken}` },
      );
      expect(candidateResult.status).toBe(200);

      const result = await fetch(
        `${baseUrl}/api/reproducibility/${createdBody.reproducibility.id}`,
      );
      expect(result.status).toBe(200);
      const resultBody = ReproducibilityResponseSchema.parse(
        await result.json(),
      );
      expect(resultBody).toMatchObject({
        status: "INCONCLUSIVE",
        verdict: "INCONCLUSIVE",
        reasonCode: "NONDETERMINISTIC_RESULT",
        children: [
          {
            runId: baselineDispatch.runId,
            receipt: `/api/receipts/${baselineDispatch.runId}`,
          },
          {
            runId: candidateDispatch.runId,
            receipt: `/api/receipts/${candidateDispatch.runId}`,
          },
        ],
        comparison: {
          consistent: false,
          baseline: { verdict: "PASS" },
          candidate: { verdict: "FAIL" },
        },
      });

      for (const child of resultBody.children) {
        const receipt = await fetch(`${baseUrl}${child.receipt}`);
        expect(receipt.status).toBe(200);
      }
    } finally {
      orchestrator.stop();
      store.close();
      receiptStore.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("preserves the normal verification queue limit and replay p95", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-verify-perf-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, {
      issue: () => {
        throw new Error("not used by this queue-only fixture");
      },
    });
    const server = createApiServer({
      store,
      inspection: new InspectionService(inspectionGateway),
      orchestrator,
      bearerToken: "t".repeat(32),
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
      const initial = await sendJson(
        baseUrl,
        "/api/verify",
        "POST",
        request,
        { "idempotency-key": "verify-p95" },
      );
      expect(initial.status).toBe(202);
      expect(runner.dispatched).toHaveLength(1);

      const latencies: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const startedAt = performance.now();
        const replay = await sendJson(
          baseUrl,
          "/api/verify",
          "POST",
          request,
          { "idempotency-key": "verify-p95" },
        );
        latencies.push(performance.now() - startedAt);
        expect(replay.status).toBe(200);
      }
      const sorted = [...latencies].sort((left, right) => left - right);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
      expect(p95).toBeLessThan(1_000);

      for (let index = 0; index < 5; index += 1) {
        const queued = await sendJson(
          baseUrl,
          "/api/verify",
          "POST",
          request,
          { "idempotency-key": `verify-queued-${index}` },
        );
        expect(queued.status).toBe(202);
      }
      const overflow = await sendJson(
        baseUrl,
        "/api/verify",
        "POST",
        request,
        { "idempotency-key": "verify-overflow" },
      );
      expect(overflow.status).toBe(429);
      await expect(overflow.json()).resolves.toMatchObject({
        error: {
          code: "RUN_QUEUE_FULL",
          capacity: { active: 1, waiting: 5 },
        },
      });
    } finally {
      orchestrator.stop();
      store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
