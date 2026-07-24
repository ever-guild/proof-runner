import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  type InternalDispatchRequest,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import { ReceiptService, ReceiptStore } from "@ever-guild/proof-runner-receipt";
import type { RunnerConfig } from "../../runner/src/config.js";
import { createRunnerServer } from "../../runner/src/server.js";
import { RunnerService } from "../../runner/src/service.js";
import { InspectionService, type InspectionGateway } from "../src/inspection.js";
import {
  HttpRunnerClient,
  Orchestrator,
  type RunnerClient,
} from "../src/orchestration.js";
import { createApiServer } from "../src/server.js";
import { RunStore } from "../src/store.js";

const token = "t".repeat(32);
const resolvedCommitSha = "a".repeat(40);
const request: VerifyRequest = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha,
  resolvedRef: { type: "tag", value: "demo-fixed" },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  public: true,
};

const inspectionGateway: InspectionGateway = {
  resolve: async () => resolvedCommitSha,
  file: async (_repositoryUrl, _commit, path) => ({
    "package.json": JSON.stringify({ packageManager: "npm@10.0.0" }),
    "package-lock.json": "{}",
  }[path] ?? null),
};

const close = (server: { close(callback: (error?: Error) => void): unknown }): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

describe("API-to-runner callback bridge", () => {
  it("delivers a runner result through the authenticated callback and exposes its receipt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-bridge-"));
    const databasePath = join(directory, "runs.sqlite");
    const store = new RunStore(databasePath);
    const receiptStore = new ReceiptStore(databasePath);
    const { privateKey } = generateKeyPairSync("ed25519");
    const receipts = new ReceiptService(
      {
        keyId: "receipt-test-1",
        privateKeyPem: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      receiptStore,
    );
    let runnerClient: RunnerClient | null = null;
    const runnerProxy: RunnerClient = {
      dispatch: (dispatch: InternalDispatchRequest) => {
        if (!runnerClient) throw new Error("runner is not ready");
        return runnerClient.dispatch(dispatch);
      },
      cancel: (runId: string) => {
        if (!runnerClient) throw new Error("runner is not ready");
        return runnerClient.cancel(runId);
      },
    };
    const orchestrator = new Orchestrator(store, runnerProxy, receipts.signer, 5_000);
    const api = createApiServer({
      store,
      inspection: new InspectionService(inspectionGateway),
      orchestrator,
      bearerToken: token,
      receipts,
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const apiAddress = api.address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${apiAddress.port}`;
    const runnerConfig: RunnerConfig = {
      host: "127.0.0.1",
      port: 0,
      bearerToken: token,
      apiCallbackUrl: `${apiUrl}/`,
      leaseExtensionMs: 1_000,
      runtimeImage: "unused",
      proxyImage: "unused",
      workspaceRoot: directory,
      limits: {
        repositoryBytes: 1,
        fileCount: 1,
        diskBytes: 1,
        cpuCount: 1,
        memoryBytes: 16 * 1024 * 1024,
        pids: 16,
        executionMs: 180_000,
        commandOutputBytes: 1024,
      },
    };
    let releaseFirstExecution: (() => void) | undefined;
    const firstExecution = new Promise<void>((resolve) => {
      releaseFirstExecution = resolve;
    });
    const executed: string[] = [];
    const runner = createRunnerServer(
      runnerConfig,
      new RunnerService(runnerConfig, {
        execute: async (runId, verify, hooks) => {
          executed.push(runId);
          if (executed.length === 1) await firstExecution;
          hooks.onStage("TEST");
          const completedAt = new Date().toISOString();
          return {
            status: "COMPLETED",
            report: {
              contractVersion: CONTRACT_VERSION,
              runId,
              repositoryUrl: verify.repositoryUrl,
              resolvedCommitSha: verify.resolvedCommitSha,
              resolvedRef: verify.resolvedRef,
              skill: verify.skill,
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
            },
            systemError: null,
          };
        },
      }),
    );
    await new Promise<void>((resolve) => runner.listen(0, "127.0.0.1", resolve));
    const runnerAddress = runner.address() as AddressInfo;
    runnerClient = new HttpRunnerClient(
      `http://127.0.0.1:${runnerAddress.port}/`,
      token,
    );
    orchestrator.start();

    try {
      const created = await fetch(`${apiUrl}/api/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "bridge-1",
        },
        body: JSON.stringify(request),
      });
      expect(created.status).toBe(202);
      const body = await created.json() as { run: { id: string } };

      await vi.waitFor(() => expect(executed).toEqual([body.run.id]));
      const queued = await fetch(`${apiUrl}/api/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "bridge-2",
        },
        body: JSON.stringify(request),
      });
      expect(queued.status).toBe(202);
      const queuedBody = await queued.json() as { run: { id: string } };
      releaseFirstExecution?.();

      await vi.waitFor(async () => {
        const [first, second] = await Promise.all([
          fetch(`${apiUrl}/api/runs/${body.run.id}`),
          fetch(`${apiUrl}/api/runs/${queuedBody.run.id}`),
        ]);
        const [firstRun, secondRun] = await Promise.all([
          first.json() as Promise<{ status: string }>,
          second.json() as Promise<{ status: string }>,
        ]);
        expect(firstRun.status).toBe("COMPLETED");
        expect(secondRun.status).toBe("COMPLETED");
      });
      expect(executed).toEqual([body.run.id, queuedBody.run.id]);

      const delivery = runner.service.result(body.run.id);
      if (!delivery) throw new Error("runner did not retain the terminal delivery");
      const replay = await fetch(
        `${apiUrl}/internal/v1/runs/${body.run.id}/result`,
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

      const conflictingReplay = await fetch(
        `${apiUrl}/internal/v1/runs/${body.run.id}/result`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...delivery,
            completedAt: new Date(Date.now() + 1).toISOString(),
          }),
        },
      );
      expect(conflictingReplay.status).toBe(409);
      await expect(conflictingReplay.json()).resolves.toMatchObject({
        error: { code: "RESULT_CONFLICT" },
      });

      const receipt = await fetch(`${apiUrl}/api/receipts/${body.run.id}`);
      expect(receipt.status).toBe(200);
      await expect(receipt.json()).resolves.toMatchObject({
        payload: { report: { runId: body.run.id, verdict: "PASS" } },
      });
    } finally {
      orchestrator.stop();
      await close(runner);
      await close(api);
      store.close();
      receiptStore.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps a queued run retriable until delayed runner cancellation cleanup releases its slot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-lease-cleanup-"));
    const store = new RunStore(join(directory, "runs.sqlite"));
    let runnerClient: RunnerClient | null = null;
    const runnerProxy: RunnerClient = {
      dispatch: (dispatch: InternalDispatchRequest) => {
        if (!runnerClient) throw new Error("runner is not ready");
        return runnerClient.dispatch(dispatch);
      },
      cancel: (runId: string) => {
        if (!runnerClient) throw new Error("runner is not ready");
        return runnerClient.cancel(runId);
      },
    };
    const orchestrator = new Orchestrator(
      store,
      runnerProxy,
      { issue: () => { throw new Error("receipt issuance is not expected"); } },
      40,
    );
    const runnerConfig: RunnerConfig = {
      host: "127.0.0.1",
      port: 0,
      bearerToken: token,
      apiCallbackUrl: "http://127.0.0.1:1",
      leaseExtensionMs: 1_000,
      runtimeImage: "unused",
      proxyImage: "unused",
      workspaceRoot: directory,
      limits: {
        repositoryBytes: 1,
        fileCount: 1,
        diskBytes: 1,
        cpuCount: 1,
        memoryBytes: 16 * 1024 * 1024,
        pids: 16,
        executionMs: 180_000,
        commandOutputBytes: 1024,
      },
    };
    let releaseCleanup: (() => void) | undefined;
    const delayedCleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const executed: string[] = [];
    const service = new RunnerService(
      runnerConfig,
      {
        execute: async (runId) => {
          executed.push(runId);
          if (executed.length === 1) await delayedCleanup;
          return {
            status: "SYSTEM_ERROR",
            report: null,
            systemError: {
              code: "RUNNER_FAILURE",
              message: "Delayed cleanup completed.",
              retryable: true,
            },
          };
        },
      },
      null,
    );
    const runner = createRunnerServer(runnerConfig, service, { isReady: async () => true });
    const dispatches = vi.spyOn(service, "dispatch");
    const first = store.create("lease-cleanup-first", request);
    const second = store.create("lease-cleanup-second", request);
    if (first.kind !== "created" || second.kind !== "created") {
      throw new Error("expected queued runs");
    }

    await new Promise<void>((resolve) => runner.listen(0, "127.0.0.1", resolve));
    const runnerAddress = runner.address() as AddressInfo;
    runnerClient = new HttpRunnerClient(`http://127.0.0.1:${runnerAddress.port}/`, token);
    orchestrator.start();

    try {
      await vi.waitFor(() => expect(executed).toEqual([first.run.response.id]));
      await vi.waitFor(() => {
        expect(store.get(first.run.response.id)?.response).toMatchObject({
          status: "SYSTEM_ERROR",
          systemError: { code: "LEASE_EXPIRED" },
        });
      });
      await vi.waitFor(() => expect(dispatches.mock.calls.length).toBeGreaterThan(1));
      expect(executed).toEqual([first.run.response.id]);
      expect(store.get(second.run.response.id)?.response).toMatchObject({
        status: "QUEUED",
        systemError: null,
      });

      releaseCleanup?.();
      await vi.waitFor(() => {
        expect(executed).toEqual([first.run.response.id, second.run.response.id]);
      });
    } finally {
      releaseCleanup?.();
      orchestrator.stop();
      await close(runner);
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
