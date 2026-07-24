import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  type InternalResultDeliveryRequest,
  type SignedReceipt,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import { InspectionService, type InspectionGateway } from "../src/inspection.js";
import { Orchestrator, type ReceiptIssuer, type RunnerClient } from "../src/orchestration.js";
import { createApiServer } from "../src/server.js";
import { RunStore } from "../src/store.js";
import { createRunnerServer } from "../../runner/src/server.js";
import type { RunnerConfig } from "../../runner/src/config.js";
import { RunnerService } from "../../runner/src/service.js";
import { HttpRunnerClient } from "../src/orchestration.js";

const hash = "a".repeat(64);
const sha = "b".repeat(40);
const request = {
  contractVersion: CONTRACT_VERSION, repositoryUrl: "https://github.com/acme/example", resolvedCommitSha: sha,
  resolvedRef: { type: "branch" as const, value: "main" }, skill: { name: "node-typescript" as const, version: "1" as const, hash }, public: false,
};
const gateway: InspectionGateway = {
  resolve: async () => sha,
  file: async (_url, _sha, path) => ({
    "package.json": JSON.stringify({ packageManager: "pnpm@10", engines: { node: ">=22" }, scripts: { build: "pnpm build", test: "pnpm test" }, devDependencies: { typescript: "5" } }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'", "tsconfig.json": "{}", ".nvmrc": "22\n",
  }[path] ?? null),
};
class FakeRunner implements RunnerClient {
  calls: Array<{ runId: string; leaseId: string }> = [];
  cancels: string[] = [];
  async dispatch(body: { runId: string; lease: { leaseId: string } }): Promise<void> { this.calls.push({ runId: body.runId, leaseId: body.lease.leaseId }); }
  async cancel(runId: string): Promise<void> { this.cancels.push(runId); }
}
class FakeReceipts implements ReceiptIssuer {
  reports: VerificationReport[] = [];
  issue(report: VerificationReport): SignedReceipt {
    this.reports.push(report);
    return {
      contractVersion: CONTRACT_VERSION,
      payload: { contractVersion: CONTRACT_VERSION, id: report.runId, report, createdAt: report.completedAt },
      canonicalization: "JCS-RFC8785", hashAlgorithm: "SHA-256", payloadHash: "f".repeat(64),
      signatureAlgorithm: "Ed25519", keyId: "test", signature: "test",
    };
  }
}

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-api-")); directories.push(directory);
  const store = new RunStore(join(directory, "runs.sqlite"));
  const runner = new FakeRunner(); const receipts = new FakeReceipts();
  const orchestrator = new Orchestrator(store, runner, receipts, 50);
  const server = createApiServer({ store, inspection: new InspectionService(gateway), orchestrator, bearerToken: "t".repeat(32) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
  const base = `http://127.0.0.1:${address.port}`;
  const close = async () => { orchestrator.stop(); store.close(); await new Promise<void>((resolve) => server.close(() => resolve())); };
  return { store, runner, receipts, orchestrator, base, close };
};
const post = async (base: string, path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("inspection and run orchestration", () => {
  it("serves unauthenticated liveness and persistent-store readiness probes", async () => {
    const api = await setup();
    try {
      expect(await (await fetch(`${api.base}/health/live`)).json()).toEqual({ status: "live" });
      expect(await (await fetch(`${api.base}/health/ready`)).json()).toEqual({ status: "ready" });
    } finally { await api.close(); }
  });

  it("upgrades an existing 001 persistent volume before using orchestration columns", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-upgrade-")); directories.push(directory);
    const path = join(directory, "runs.sqlite");
    const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL("../../../packages/schema/migrations/001_initial.sql", import.meta.url), "utf8"));
    old.close();
    const store = new RunStore(path);
    const checked = new DatabaseSync(path);
    const columns = checked.prepare("SELECT name FROM pragma_table_info('run_metadata')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["report_json", "system_error_code", "system_error_message", "system_error_retryable"]));
    checked.close(); store.close();
  });

  it("inspects committed metadata without executing a repository", async () => {
    const service = new InspectionService(gateway);
    await expect(service.inspect("https://github.com/acme/example", { type: "branch", value: "main" })).resolves.toMatchObject({ supported: true, inspection: { resolvedCommitSha: sha, packageManager: "pnpm", hasTypeScript: true, selectedSkill: "node-typescript@1", selectedSkillHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });

  it("serves the free A2MCP inspection and verification contracts with HTTP 200", async () => {
    const api = await setup();
    try {
      const inspected = await post(api.base, "/a2mcp/inspect_repository", {
        contractVersion: CONTRACT_VERSION, repositoryUrl: request.repositoryUrl, ref: request.resolvedRef,
      });
      expect(inspected.status).toBe(200);
      expect(await inspected.json()).toMatchObject({ operation: "inspect_repository", result: { supported: true } });
      const verified = await post(api.base, "/a2mcp/verify_repository", { ...request, idempotencyKey: "a2mcp-key" });
      expect(verified.status).toBe(200);
      expect(await verified.json()).toMatchObject({ operation: "verify_repository", result: { status: expect.stringMatching(/^(QUEUED|RUNNING)$/) } });
    } finally { await api.close(); }
  });

  it("enforces idempotency and a one-active/five-waiting FIFO queue", async () => {
    const api = await setup();
    try {
      const first = await post(api.base, "/api/verify", request, { "idempotency-key": "first" });
      expect(first.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(api.runner.calls).toHaveLength(1);
      const replay = await post(api.base, "/api/verify", request, { "idempotency-key": "first" });
      expect(replay.status).toBe(200); expect((await replay.json() as { replayed: boolean }).replayed).toBe(true);
      const conflict = await post(api.base, "/api/verify", { ...request, public: true }, { "idempotency-key": "first" });
      expect(conflict.status).toBe(409);
      for (let index = 0; index < 5; index += 1) expect((await post(api.base, "/api/verify", request, { "idempotency-key": `q${index}` })).status).toBe(202);
      const full = await post(api.base, "/api/verify", request, { "idempotency-key": "overflow" });
      expect(full.status).toBe(429); expect((await full.json() as { error: { code: string } }).error.code).toBe("RUN_QUEUE_FULL");
      const queued = await (await fetch(`${api.base}/api/runs/${(await first.json() as { run: { id: string } }).run.id}`)).json() as { status: string };
      expect(queued.status).toBe("RUNNING");
    } finally { await api.close(); }
  });

  it("persists normalized terminal reports through restart and dispatches FIFO successor", async () => {
    const api = await setup();
    try {
      const first = await post(api.base, "/api/verify", request, { "idempotency-key": "one" });
      const firstRun = (await first.json() as { run: { id: string } }).run.id;
      await post(api.base, "/api/verify", request, { "idempotency-key": "two" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const leaseId = api.runner.calls[0]?.leaseId; expect(leaseId).toBeTruthy();
      const completedAt = new Date().toISOString();
      const report: VerificationReport = { contractVersion: CONTRACT_VERSION, runId: firstRun, repositoryUrl: request.repositoryUrl, resolvedCommitSha: sha, resolvedRef: request.resolvedRef, skill: request.skill, runtimeImageDigest: `sha256:${"c".repeat(64)}`, verdict: "PASS", checks: [{ id: "test", stage: "TEST", title: "Test", outcome: "PASSED", startedAt: completedAt, completedAt, durationMs: 0, exitCode: 0, summary: "Passed" }], durationMs: 0, completedAt, reasonCode: null };
      const result: InternalResultDeliveryRequest = { contractVersion: CONTRACT_VERSION, leaseId: leaseId!, completedAt, status: "COMPLETED", report, systemError: null };
      const callback = await fetch(`${api.base}/internal/v1/runs/${firstRun}/result`, { method: "PUT", headers: { authorization: `Bearer ${"t".repeat(32)}`, "content-type": "application/json" }, body: JSON.stringify(result) });
      expect(callback.status).toBe(200);
      expect(api.receipts.reports).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(api.runner.calls).toHaveLength(2);
      const persisted = api.store.get(firstRun)?.response;
      expect(persisted).toMatchObject({ status: "COMPLETED", verdict: "PASS", report: { checks: [{ id: "test", outcome: "PASSED" }] } });
      const databasePath = join(directories[0]!, "runs.sqlite");
      api.orchestrator.stop(); api.store.close();
      const restarted = new RunStore(databasePath);
      expect(restarted.get(firstRun)?.response).toMatchObject({ status: "COMPLETED", report: { verdict: "PASS" } });
      restarted.close();
    } finally { await api.close().catch(() => undefined); }
  });

  it("persists a terminal result across the real authenticated API-runner HTTP bridge", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-bridge-")); directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const receipts = new FakeReceipts();
    const runnerClient: { value?: RunnerClient } = {};
    const orchestrator = new Orchestrator(store, { dispatch: (body) => runnerClient.value!.dispatch(body), cancel: (id) => runnerClient.value!.cancel(id) }, receipts, 50);
    const apiServer = createApiServer({ store, inspection: new InspectionService(gateway), orchestrator, bearerToken: "t".repeat(32) });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    const apiAddress = apiServer.address(); if (!apiAddress || typeof apiAddress === "string") throw new Error("missing API address");
    const apiBase = `http://127.0.0.1:${apiAddress.port}`;
    const config: RunnerConfig = { host: "127.0.0.1", port: 0, bearerToken: "t".repeat(32), apiCallbackUrl: apiBase, leaseExtensionMs: 30_000, runtimeImage: "unused", proxyImage: "unused", workspaceRoot: directory, limits: { repositoryBytes: 1, fileCount: 1, diskBytes: 1, cpuCount: 1, memoryBytes: 16 * 1024 * 1024, pids: 16, executionMs: 180_000, commandOutputBytes: 1024 } };
    const runner = createRunnerServer(config, new RunnerService(config, {
      execute: async (runId, verify, controls) => {
        controls.onStage("TEST");
        await new Promise((resolve) => setTimeout(resolve, 30));
        controls.onStage("TEST");
        await new Promise((resolve) => setTimeout(resolve, 30));
        const completedAt = new Date().toISOString();
        return { status: "COMPLETED", systemError: null, report: { contractVersion: CONTRACT_VERSION, runId, repositoryUrl: verify.repositoryUrl, resolvedCommitSha: verify.resolvedCommitSha, resolvedRef: verify.resolvedRef, skill: verify.skill, runtimeImageDigest: `sha256:${"d".repeat(64)}`, verdict: "PASS", checks: [{ id: "test", stage: "TEST", title: "Test", outcome: "PASSED", startedAt: completedAt, completedAt, durationMs: 0, exitCode: 0, summary: "Passed" }], durationMs: 0, completedAt, reasonCode: null } };
      },
    }));
    await new Promise<void>((resolve) => runner.listen(0, "127.0.0.1", resolve));
    const runnerAddress = runner.address(); if (!runnerAddress || typeof runnerAddress === "string") throw new Error("missing runner address");
    const httpClient = new HttpRunnerClient(`http://127.0.0.1:${runnerAddress.port}`, config.bearerToken);
    runnerClient.value = { dispatch: (body) => httpClient.dispatch(body), cancel: (id) => httpClient.cancel(id) };
    orchestrator.start();
    try {
      const creation = await post(apiBase, "/api/verify", request, { "idempotency-key": "bridge" });
      const id = (await creation.json() as { run: { id: string } }).run.id;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(store.get(id)?.response.status).toBe("COMPLETED");
      expect(store.get(id)?.response).toMatchObject({ verdict: "PASS", report: { checks: [{ outcome: "PASSED" }] } });
      expect(receipts.reports).toHaveLength(1);
    } finally {
      orchestrator.stop(); store.close();
      await new Promise<void>((resolve) => runner.close(() => resolve()));
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    }
  });
});
