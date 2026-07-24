import { randomUUID } from "node:crypto";
import type { VerifyRequest } from "@ever-guild/proof-runner-schema";
import { CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";
import { describe, expect, it, vi } from "vitest";
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
});
