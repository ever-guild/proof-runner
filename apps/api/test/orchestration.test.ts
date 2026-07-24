import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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
  type ReceiptIssuer,
  type RunnerClient,
} from "../src/orchestration.js";
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
  readonly cancelled: string[] = [];

  async dispatch(run: InternalDispatchRequest): Promise<void> {
    this.dispatched.push(run);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
  }
}

const receipts: ReceiptIssuer = {
  issue: () => {
    throw new Error("receipt issuance is not part of this dispatch slice");
  },
};

describe("Orchestrator", () => {
  it("claims the next run and dispatches it with a bounded lease", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-orchestration-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const created = store.create("run-1", request);
    if (created.kind !== "created") throw new Error("expected a queued run");
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts, 30_000);

    try {
      await orchestrator.dispatchNext();

      expect(runner.dispatched).toHaveLength(1);
      expect(runner.dispatched[0]).toMatchObject({
        contractVersion: CONTRACT_VERSION,
        runId: created.run.response.id,
        request,
      });
      expect(
        new Date(runner.dispatched[0]!.lease.leaseExpiresAt).getTime(),
      ).toBeGreaterThan(Date.now());
      expect(store.get(created.run.response.id)?.response).toMatchObject({
        status: "RUNNING",
        activeStage: "SANDBOX",
      });
    } finally {
      orchestrator.stop();
      store.close();
    }
  });

  it("keeps queued and completed state plus normalized checks across an API restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-terminal-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const store = new RunStore(databasePath);
    const receiptStore = new ReceiptStore(databasePath);
    const { privateKey } = generateKeyPairSync("ed25519");
    const receiptService = new ReceiptService(
      {
        keyId: "receipt-test-1",
        privateKeyPem: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      receiptStore,
    );
    const created = store.create("terminal-1", request);
    if (created.kind !== "created") throw new Error("expected a queued run");
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receiptService.signer);

    try {
      await orchestrator.dispatchNext();
      const leaseId = runner.dispatched[0]?.lease.leaseId;
      if (!leaseId) throw new Error("expected a runner dispatch");
      const completedAt = new Date().toISOString();
      const report: VerificationReport = {
        contractVersion: CONTRACT_VERSION,
        runId: created.run.response.id,
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
      const result: InternalResultDeliveryRequest = {
        contractVersion: CONTRACT_VERSION,
        leaseId,
        completedAt,
        status: "COMPLETED",
        report,
        systemError: null,
      };

      await expect(orchestrator.result(created.run.response.id, result)).resolves.toBe(
        "ACCEPTED",
      );
      await expect(orchestrator.result(created.run.response.id, result)).resolves.toBe(
        "ACCEPTED",
      );
      await expect(
        orchestrator.result(created.run.response.id, {
          ...result,
          completedAt: new Date(Date.now() + 1).toISOString(),
        }),
      ).resolves.toBe("RESULT_CONFLICT");
      expect(store.get(created.run.response.id)?.response).toMatchObject({
        status: "COMPLETED",
        verdict: "PASS",
        links: { receipt: `/api/receipts/${created.run.response.id}` },
        report: { checks: [{ id: "test", outcome: "PASSED" }] },
      });

      const queued = store.create("queued-after-restart", request);
      if (queued.kind !== "created") throw new Error("expected a queued run");

      store.close();
      const restarted = new RunStore(databasePath);
      try {
        expect(restarted.get(created.run.response.id)?.response).toMatchObject({
          status: "COMPLETED",
          verdict: "PASS",
          report: {
            resolvedCommitSha: request.resolvedCommitSha,
            checks: [{ id: "test", stage: "TEST", outcome: "PASSED" }],
          },
        });
        expect(restarted.get(queued.run.response.id)?.response).toMatchObject({
          status: "QUEUED",
          queuePosition: 1,
        });

        const database = new DatabaseSync(databasePath);
        try {
          expect(
            database.prepare(
              "SELECT check_id, stage, outcome FROM normalized_checks WHERE run_id = ?",
            ).all(created.run.response.id),
          ).toEqual([{ check_id: "test", stage: "TEST", outcome: "PASSED" }]);
        } finally {
          database.close();
        }
      } finally {
        restarted.close();
      }
    } finally {
      orchestrator.stop();
      receiptStore.close();
    }
  });

  it("converts runner failures into generic INCONCLUSIVE system errors", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-system-error-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const created = store.create("error-1", request);
    if (created.kind !== "created") throw new Error("expected a queued run");
    const next = store.create("error-2", request);
    if (next.kind !== "created") throw new Error("expected a waiting run");
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts);

    try {
      await orchestrator.dispatchNext();
      const leaseId = runner.dispatched[0]?.lease.leaseId;
      if (!leaseId) throw new Error("expected a runner dispatch");

      await expect(
        orchestrator.result(created.run.response.id, {
          contractVersion: CONTRACT_VERSION,
          leaseId,
          completedAt: new Date().toISOString(),
          status: "SYSTEM_ERROR",
          report: null,
          systemError: {
            code: "DATABASE_URL",
            message: "postgres://internal-user:secret@db.internal/proof-runner",
            retryable: true,
          },
        }),
      ).resolves.toBe("ACCEPTED");

      const stored = store.get(created.run.response.id)?.response;
      expect(stored).toMatchObject({
        status: "SYSTEM_ERROR",
        verdict: "INCONCLUSIVE",
        systemError: {
          code: "RUNNER_FAILURE",
          message: "The runner could not complete this run.",
          retryable: true,
        },
      });
      expect(JSON.stringify(stored)).not.toContain("secret@db.internal");
      expect(runner.dispatched).toHaveLength(2);
      expect(runner.dispatched[1]).toMatchObject({ runId: next.run.response.id });
    } finally {
      orchestrator.stop();
      store.close();
    }
  });

  it("cancels and waits out an ambiguous dispatch before draining the queue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-ambiguous-dispatch-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const first = store.create("ambiguous-first", request);
    const second = store.create("ambiguous-second", request);
    if (first.kind !== "created" || second.kind !== "created") {
      throw new Error("expected queued runs");
    }
    class AmbiguousRunner extends RecordingRunner {
      override async dispatch(run: InternalDispatchRequest): Promise<void> {
        this.dispatched.push(run);
        if (this.dispatched.length === 1) throw new Error("response was lost");
      }
    }
    const runner = new AmbiguousRunner();
    const orchestrator = new Orchestrator(store, runner, receipts, 100);

    try {
      await orchestrator.dispatchNext();
      expect(store.get(first.run.response.id)?.response).toMatchObject({
        status: "SYSTEM_ERROR",
        systemError: { code: "RUNNER_UNAVAILABLE" },
      });
      await vi.waitFor(() => expect(runner.cancelled).toEqual([first.run.response.id]));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(runner.dispatched).toHaveLength(1);

      await vi.waitFor(() => {
        expect(runner.dispatched).toHaveLength(2);
        expect(runner.dispatched[1]).toMatchObject({ runId: second.run.response.id });
      });
    } finally {
      orchestrator.stop();
      store.close();
    }
  });

  it("quarantines an ambiguous dispatch until its latest accepted heartbeat expires", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-renewed-dispatch-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const first = store.create("renewed-first", request);
    const second = store.create("renewed-second", request);
    if (first.kind !== "created" || second.kind !== "created") {
      throw new Error("expected queued runs");
    }

    const runner = {
      dispatched: [] as InternalDispatchRequest[],
      cancelled: [] as string[],
      async dispatch(run: InternalDispatchRequest): Promise<void> {
        this.dispatched.push(run);
        if (this.dispatched.length > 1) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(
          orchestrator.heartbeat(run.runId, run.lease.leaseId, "TEST"),
        ).toMatchObject({ kind: "ACCEPTED" });
        throw new Error("dispatch response was lost after a renewal");
      },
      async cancel(runId: string): Promise<void> {
        this.cancelled.push(runId);
        throw new Error("runner is unreachable");
      },
    };
    const orchestrator = new Orchestrator(store, runner, receipts, 100);

    try {
      await orchestrator.dispatchNext();
      await vi.waitFor(() => expect(runner.cancelled).toEqual([first.run.response.id]));
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(runner.dispatched).toHaveLength(1);

      await vi.waitFor(() => {
        expect(runner.dispatched).toHaveLength(2);
        expect(runner.dispatched[1]).toMatchObject({ runId: second.run.response.id });
      });
    } finally {
      orchestrator.stop();
      store.close();
    }
  });

  it("cancels an expired lease and makes the run terminal before dispatching another", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-expired-lease-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const created = store.create("lease-1", request);
    if (created.kind !== "created") throw new Error("expected a queued run");
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts, 20);

    try {
      orchestrator.start();
      await vi.waitFor(() => {
        expect(store.get(created.run.response.id)?.response).toMatchObject({
          status: "SYSTEM_ERROR",
          verdict: "INCONCLUSIVE",
          systemError: { code: "LEASE_EXPIRED" },
        });
      });
      expect(runner.cancelled).toEqual([created.run.response.id]);
    } finally {
      orchestrator.stop();
      store.close();
    }
  });

  it("cancels interrupted work and waits out its lease before dispatching the queue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-recovery-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const interrupted = store.create("interrupted", request);
    const queued = store.create("queued", request);
    if (interrupted.kind !== "created" || queued.kind !== "created") {
      throw new Error("expected queued runs");
    }
    expect(store.claimNext()?.response.id).toBe(interrupted.run.response.id);
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts, 40);

    try {
      orchestrator.start();

      expect(store.get(interrupted.run.response.id)?.response).toMatchObject({
        status: "SYSTEM_ERROR",
        systemError: { code: "API_RESTARTED" },
      });
      expect(store.get(queued.run.response.id)?.response.status).toBe("QUEUED");
      await vi.waitFor(() => expect(runner.cancelled).toEqual([interrupted.run.response.id]));
      expect(runner.dispatched).toHaveLength(0);

      await vi.waitFor(() => {
        expect(runner.dispatched).toHaveLength(1);
        expect(runner.dispatched[0]).toMatchObject({ runId: queued.run.response.id });
      });
    } finally {
      orchestrator.stop();
      store.close();
    }
  });
});
