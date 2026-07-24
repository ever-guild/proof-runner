import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerConfig } from "../src/config.js";
import type { SandboxExecution } from "../src/sandbox.js";
import { createRunnerServer, type RunnerHttpServer } from "../src/server.js";
import { RunnerService } from "../src/service.js";

const token = "server-test-token".repeat(3);
const config: RunnerConfig = {
  host: "127.0.0.1",
  port: 0,
  bearerToken: token,
  apiCallbackUrl: "http://127.0.0.1:8787",
  leaseExtensionMs: 30_000,
  runtimeImage: "unused",
  proxyImage: "unused",
  workspaceRoot: "/tmp/proof-runner-server-tests",
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

describe("internal runner HTTP contract", () => {
  let server: RunnerHttpServer;
  let origin: string;

  beforeEach(async () => {
    const sandbox = {
      execute: () => new Promise<SandboxExecution>(() => undefined),
    };
    server = createRunnerServer(config, new RunnerService(config, sandbox), { isReady: async () => true });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const request = async (
    path: string,
    method: string,
    body?: unknown,
    authorization = `Bearer ${token}`,
  ) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        authorization,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it("fails closed without bearer auth and rejects version drift", async () => {
    const unauthorized = await request(
      "/internal/v1/runs/missing/status",
      "GET",
      undefined,
      "",
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });

    const mismatch = await request("/internal/v1/runs", "POST", {
      contractVersion: "0.9",
    });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({
      error: { code: "VERSION_MISMATCH" },
    });
  });

  it("exposes health probes without exposing the internal control plane", async () => {
    expect(await (await fetch(`${origin}/health/live`)).json()).toEqual({ status: "live" });
    expect(await (await fetch(`${origin}/health/ready`)).json()).toEqual({ status: "ready" });
    const unauthorized = await request("/internal/v1/runs/missing/status", "GET", undefined, "");
    expect(unauthorized.status).toBe(401);
  });

  it("reports not ready when Docker or the API callback cannot be reached", async () => {
    const unavailable = createRunnerServer(config, new RunnerService(config, { execute: () => new Promise<SandboxExecution>(() => undefined) }), { isReady: async () => false });
    await new Promise<void>((resolve) => unavailable.listen(0, "127.0.0.1", resolve));
    const address = unavailable.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "not_ready" });
    } finally {
      await new Promise<void>((resolve, reject) => unavailable.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("dispatches, reports status, renews heartbeat, and cancels", async () => {
    const runId = randomUUID();
    const leaseId = randomUUID();
    const dispatched = await request("/internal/v1/runs", "POST", {
      contractVersion: CONTRACT_VERSION,
      runId,
      lease: {
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      request: {
        contractVersion: CONTRACT_VERSION,
        repositoryUrl: "https://github.com/ever-guild/site",
        resolvedCommitSha: "1".repeat(40),
        resolvedRef: { type: "branch", value: "main" },
        skill: {
          name: "node-typescript",
          version: "1",
          hash: "2".repeat(64),
        },
        public: false,
      },
    });
    expect(dispatched.status).toBe(202);

    const status = await request(`/internal/v1/runs/${runId}/status`, "GET");
    expect(await status.json()).toMatchObject({ runId, status: "RUNNING" });

    const heartbeat = await request(
      `/internal/v1/runs/${runId}/heartbeat`,
      "POST",
      {
        contractVersion: CONTRACT_VERSION,
        leaseId,
        observedAt: new Date().toISOString(),
        activeStage: "INSTALL",
      },
    );
    expect(heartbeat.status).toBe(200);
    expect(await heartbeat.json()).toMatchObject({
      lease: { leaseId },
      cancellationRequested: false,
    });

    const cancelled = await request(
      `/internal/v1/runs/${runId}/cancel`,
      "POST",
      {
        contractVersion: CONTRACT_VERSION,
        reason: "USER_REQUESTED",
        requestedAt: new Date().toISOString(),
      },
    );
    expect(cancelled.status).toBe(202);
    expect(await cancelled.json()).toMatchObject({
      runId,
      cancellationRequested: true,
    });
  });
});
