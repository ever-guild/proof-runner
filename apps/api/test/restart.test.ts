import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  type InternalDispatchRequest,
  type InternalResultDeliveryRequest,
  type VerificationReport,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import { ReceiptService, ReceiptStore } from "@ever-guild/proof-runner-receipt";
import {
  Orchestrator,
  type RunnerClient,
} from "../src/orchestration.js";
import { InspectionService } from "../src/inspection.js";
import { createApiServer } from "../src/server.js";
import { RunStore } from "../src/store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const token = "t".repeat(32);
const request: VerifyRequest = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha: "a".repeat(40),
  resolvedRef: { type: "tag", value: "demo-fixed" },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  public: false,
};

class RecordingRunner implements RunnerClient {
  readonly dispatched: InternalDispatchRequest[] = [];

  async dispatch(run: InternalDispatchRequest): Promise<void> {
    this.dispatched.push(run);
  }

  async cancel(): Promise<void> {}
}

const inspection = new InspectionService();

const close = (server: { close(callback: (error?: Error) => void): unknown }): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

const reportFor = (runId: string): VerificationReport => {
  const completedAt = new Date().toISOString();
  return {
    contractVersion: CONTRACT_VERSION,
    runId,
    repositoryUrl: request.repositoryUrl,
    resolvedCommitSha: request.resolvedCommitSha,
    resolvedRef: request.resolvedRef,
    skill: request.skill,
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
        durationMs: 0,
        exitCode: 0,
        summary: "All tests passed.",
      },
    ],
    durationMs: 0,
    completedAt,
    reasonCode: null,
  };
};

describe("API process restart", () => {
  it("serves persisted completed and queued runs before resuming the queue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-api-restart-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const { privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const key = { keyId: "receipt-test-1", privateKeyPem };

    const store = new RunStore(databasePath);
    const receiptStore = new ReceiptStore(databasePath);
    const receipts = new ReceiptService(key, receiptStore);
    const firstRunner = new RecordingRunner();
    const firstOrchestrator = new Orchestrator(store, firstRunner, receipts.signer);
    const firstApi = createApiServer({
      store,
      inspection,
      orchestrator: firstOrchestrator,
      bearerToken: token,
      receipts,
    });
    await new Promise<void>((resolve) => firstApi.listen(0, "127.0.0.1", resolve));
    const firstAddress = firstApi.address() as AddressInfo;
    const firstUrl = `http://127.0.0.1:${firstAddress.port}`;

    let restartedApi: ReturnType<typeof createApiServer> | null = null;
    let restartedStore: RunStore | null = null;
    let restartedReceiptStore: ReceiptStore | null = null;
    let restartedOrchestrator: Orchestrator | null = null;

    try {
      const created = await fetch(`${firstUrl}/api/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "completed-before-restart",
        },
        body: JSON.stringify(request),
      });
      const body = await created.json() as { run: { id: string } };
      expect(created.status).toBe(202);
      const leaseId = firstRunner.dispatched[0]?.lease.leaseId;
      if (!leaseId) throw new Error("expected the first runner dispatch");
      const report = reportFor(body.run.id);
      const delivery: InternalResultDeliveryRequest = {
        contractVersion: CONTRACT_VERSION,
        leaseId,
        completedAt: report.completedAt,
        status: "COMPLETED",
        report,
        systemError: null,
      };
      await expect(firstOrchestrator.result(body.run.id, delivery)).resolves.toBe(
        "ACCEPTED",
      );
      const queued = store.create("queued-before-restart", request);
      if (queued.kind !== "created") throw new Error("expected a queued run");

      firstOrchestrator.stop();
      await close(firstApi);
      store.close();
      receiptStore.close();

      restartedStore = new RunStore(databasePath);
      restartedReceiptStore = new ReceiptStore(databasePath);
      const restartedReceipts = new ReceiptService(key, restartedReceiptStore);
      const restartedRunner = new RecordingRunner();
      restartedOrchestrator = new Orchestrator(
        restartedStore,
        restartedRunner,
        restartedReceipts.signer,
      );
      restartedApi = createApiServer({
        store: restartedStore,
        inspection,
        orchestrator: restartedOrchestrator,
        bearerToken: token,
        receipts: restartedReceipts,
      });
      await new Promise<void>((resolve) => restartedApi.listen(0, "127.0.0.1", resolve));
      const restartedAddress = restartedApi.address() as AddressInfo;
      const restartedUrl = `http://127.0.0.1:${restartedAddress.port}`;

      const completed = await fetch(`${restartedUrl}/api/runs/${body.run.id}`);
      expect(await completed.json()).toMatchObject({
        status: "COMPLETED",
        report: { checks: [{ id: "test", outcome: "PASSED" }] },
      });
      const queuedBeforeResume = await fetch(
        `${restartedUrl}/api/runs/${queued.run.response.id}`,
      );
      await expect(queuedBeforeResume.json()).resolves.toMatchObject({
        status: "QUEUED",
        queuePosition: 1,
      });

      const replay = await fetch(
        `${restartedUrl}/internal/v1/runs/${body.run.id}/result`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(delivery),
        },
      );
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({ accepted: true });

      restartedOrchestrator.start();
      await vi.waitFor(() => {
        expect(restartedRunner.dispatched).toHaveLength(1);
        expect(restartedRunner.dispatched[0]).toMatchObject({
          runId: queued.run.response.id,
        });
      });
    } finally {
      restartedOrchestrator?.stop();
      if (restartedApi) await close(restartedApi);
      restartedStore?.close();
      restartedReceiptStore?.close();
    }
  });
});
