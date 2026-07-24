import { randomUUID } from "node:crypto";
import type { VerifyRequest } from "@ever-guild/proof-runner-schema";
import { CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";
import { describe, expect, it, vi } from "vitest";
import { ApiCallbackError } from "../src/api-client.js";
import type { RunnerConfig } from "../src/config.js";
import type { SandboxExecution } from "../src/sandbox.js";
import { RunnerService } from "../src/service.js";

const config: RunnerConfig = {
  host: "127.0.0.1",
  port: 8788,
  bearerToken: "a".repeat(32),
  leaseExtensionMs: 30_000,
  runtimeImage: "unused",
  proxyImage: "unused",
  workspaceRoot: "/tmp/proof-runner-tests",
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

const request: VerifyRequest = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl: "https://github.com/ever-guild/proof-runner",
  resolvedCommitSha: "1".repeat(40),
  resolvedRef: { type: "branch", value: "main" },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "2".repeat(64),
  },
  public: false,
};

const dispatch = () => ({
  contractVersion: CONTRACT_VERSION,
  runId: randomUUID(),
  lease: {
    leaseId: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  request,
});

const neverSandbox = {
  execute: vi.fn(
    () => new Promise<SandboxExecution>(() => undefined),
  ),
};

describe("versioned leased runner service", () => {
  it("fails bearer authentication closed", () => {
    const service = new RunnerService(config, neverSandbox);
    expect(() => service.authenticate(undefined)).toThrowError(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
    expect(() => service.authenticate("Bearer wrong")).toThrowError(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
    expect(() => service.authenticate(`Bearer ${config.bearerToken}`)).not.toThrow();
  });

  it("enforces concurrency one, heartbeat renewal, cancellation, and cleanup handoff", async () => {
    let finish: ((value: SandboxExecution) => void) | undefined;
    const execution = new Promise<SandboxExecution>((resolve) => {
      finish = resolve;
    });
    const service = new RunnerService(config, { execute: () => execution });
    const first = dispatch();
    service.dispatch(first);
    expect(() => service.dispatch(dispatch())).toThrowError(
      expect.objectContaining({ code: "RUNNER_UNAVAILABLE" }),
    );

    const heartbeat = service.heartbeat(
      first.runId,
      first.lease.leaseId,
      new Date().toISOString(),
      "INSTALL",
    );
    expect(heartbeat.lease.leaseExpiresAt).not.toBe(first.lease.leaseExpiresAt);
    expect(service.status(first.runId).activeStage).toBe("INSTALL");
    expect(service.cancel(first.runId).cancellationRequested).toBe(true);

    finish?.({
      status: "SYSTEM_ERROR",
      report: null,
      systemError: {
        code: "CANCELLED",
        message: "Cancelled",
        retryable: false,
      },
    });
    await vi.waitFor(() => expect(service.result(first.runId)).not.toBeNull());
    expect(service.status(first.runId).status).toBe("SYSTEM_ERROR");
    expect(() => service.dispatch(dispatch())).not.toThrow();
  });

  it("rejects expired and mismatched leases", () => {
    const service = new RunnerService(config, neverSandbox);
    const expired = dispatch();
    expired.lease.leaseExpiresAt = new Date(Date.now() - 1).toISOString();
    expect(() => service.dispatch(expired)).toThrowError(
      expect.objectContaining({ code: "LEASE_EXPIRED" }),
    );

    const live = dispatch();
    service.dispatch(live);
    expect(() =>
      service.heartbeat(
        live.runId,
        randomUUID(),
        new Date().toISOString(),
        "TEST",
      ),
    ).toThrowError(expect.objectContaining({ code: "LEASE_MISMATCH" }));
  });

  it("does not release concurrency until externally completed sandbox cleanup finishes", async () => {
    let cleanupFinished: (() => void) | undefined;
    const cleanup = new Promise<SandboxExecution>((resolve) => {
      cleanupFinished = () =>
        resolve({
          status: "SYSTEM_ERROR",
          report: null,
          systemError: {
            code: "CANCELLED",
            message: "Cleanup complete",
            retryable: false,
          },
        });
    });
    const service = new RunnerService(config, { execute: () => cleanup });
    const first = dispatch();
    service.dispatch(first);
    const completedAt = new Date().toISOString();
    service.deliverResult(first.runId, {
      contractVersion: CONTRACT_VERSION,
      leaseId: first.lease.leaseId,
      completedAt,
      status: "SYSTEM_ERROR",
      report: null,
      systemError: {
        code: "RUNNER_FAILURE",
        message: "Externally delivered",
        retryable: true,
      },
    });
    expect(() => service.dispatch(dispatch())).toThrowError(
      expect.objectContaining({ code: "RUNNER_UNAVAILABLE" }),
    );
    cleanupFinished?.();
    await vi.waitFor(() => expect(() => service.dispatch(dispatch())).not.toThrow());
  });

  it("redacts unexpected sandbox failures before they leave the runner", async () => {
    const service = new RunnerService(config, {
      execute: async () => {
        throw new Error("postgres://internal-user:secret@db.internal/proof-runner");
      },
    });
    const run = dispatch();

    service.dispatch(run);

    await vi.waitFor(() => expect(service.result(run.runId)).not.toBeNull());
    const result = service.result(run.runId);
    expect(result).toMatchObject({
      status: "SYSTEM_ERROR",
      systemError: {
        code: "RUNNER_FAILURE",
        message: "The runner could not complete this verification.",
        retryable: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret@db.internal");
  });

  it("renews using the dispatched API lease even when runner extension is longer", async () => {
    let finish: ((value: SandboxExecution) => void) | undefined;
    const execution = new Promise<SandboxExecution>((resolve) => {
      finish = resolve;
    });
    const callback = {
      heartbeat: vi.fn(async () => ({
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        cancellationRequested: false,
      })),
      result: vi.fn(async () => undefined),
    };
    const service = new RunnerService(
      { ...config, leaseExtensionMs: 10_000 },
      { execute: () => execution },
      callback,
    );
    const run = dispatch();
    run.lease.leaseExpiresAt = new Date(Date.now() + 100).toISOString();

    service.dispatch(run);

    await vi.waitFor(() => expect(callback.heartbeat).toHaveBeenCalledTimes(1));
    finish?.({
      status: "SYSTEM_ERROR",
      report: null,
      systemError: {
        code: "RUNNER_FAILURE",
        message: "Sandbox cleanup completed.",
        retryable: true,
      },
    });
    await vi.waitFor(() => expect(callback.result).toHaveBeenCalledTimes(1));
  });

  it("reports stage progress and the terminal result to the API callback", async () => {
    const callback = {
      heartbeat: vi.fn(async () => ({
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        cancellationRequested: false,
      })),
      result: vi.fn(async () => undefined),
    };
    const service = new RunnerService(
      config,
      {
        execute: async (runId, verify, hooks) => {
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
      },
      callback,
    );
    const run = dispatch();

    service.dispatch(run);

    await vi.waitFor(() => expect(callback.result).toHaveBeenCalledTimes(1));
    expect(callback.heartbeat).toHaveBeenCalledWith(
      run.runId,
      run.lease.leaseId,
      "TEST",
    );
    expect(callback.result).toHaveBeenCalledWith(
      run.runId,
      expect.objectContaining({
        leaseId: run.lease.leaseId,
        status: "COMPLETED",
        report: expect.objectContaining({ verdict: "PASS" }),
      }),
    );
  });

  it("does not retry a terminal callback rejected by the API", async () => {
    const callback = {
      heartbeat: vi.fn(async () => ({
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        cancellationRequested: false,
      })),
      result: vi.fn(async () => {
        throw new ApiCallbackError(409, "LEASE_EXPIRED");
      }),
    };
    const service = new RunnerService(
      config,
      {
        execute: async () => ({
          status: "SYSTEM_ERROR",
          report: null,
          systemError: {
            code: "RUNNER_FAILURE",
            message: "The runner could not complete this verification.",
            retryable: true,
          },
        }),
      },
      callback,
    );
    const run = dispatch();

    service.dispatch(run);

    await vi.waitFor(() => expect(callback.result).toHaveBeenCalledTimes(1));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(callback.result).toHaveBeenCalledTimes(1);
  });

  it("uses a late heartbeat lease extension while retrying a terminal callback", async () => {
    let extendLease: (() => void) | undefined;
    let attempts = 0;
    const callback = {
      heartbeat: vi.fn(
        () => new Promise<{ leaseExpiresAt: string; cancellationRequested: boolean }>(
          (resolve) => {
            extendLease = () => resolve({
              leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
              cancellationRequested: false,
            });
          },
        ),
      ),
      result: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          setTimeout(() => extendLease?.(), 10);
          throw new ApiCallbackError(503, "INTERNAL_ERROR");
        }
      }),
    };
    const service = new RunnerService(
      config,
      {
        execute: async (_runId, _verify, hooks) => {
          hooks.onStage("TEST");
          return {
            status: "SYSTEM_ERROR",
            report: null,
            systemError: {
              code: "RUNNER_FAILURE",
              message: "The runner could not complete this verification.",
              retryable: true,
            },
          };
        },
      },
      callback,
    );
    const run = dispatch();
    // Keep this below the 100 ms retry delay: the old fixed-deadline loop
    // stopped after its first failure, while the renewed lease must permit a
    // second attempt.
    run.lease.leaseExpiresAt = new Date(Date.now() + 90).toISOString();

    service.dispatch(run);

    await vi.waitFor(() => expect(callback.heartbeat).toHaveBeenCalled());
    await vi.waitFor(() => {
      expect(new Date(service.status(run.runId).lease.leaseExpiresAt).getTime())
        .toBeGreaterThan(Date.now() + 1_000);
    });
    await vi.waitFor(() => expect(callback.result).toHaveBeenCalledTimes(2));
  });
});
