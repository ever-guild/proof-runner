import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  type InternalDispatchRequest,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import {
  InspectionService,
  type InspectionGateway,
} from "../src/inspection.js";
import {
  Orchestrator,
  type ReceiptIssuer,
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

const resolvedCommitSha = "a".repeat(40);
const request: VerifyRequest = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha,
  resolvedRef: { type: "branch", value: "main" },
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

const receipts: ReceiptIssuer = { issue: () => undefined };

const inspectionGateway: InspectionGateway = {
  resolve: async () => resolvedCommitSha,
  file: async (_repositoryUrl, _commit, path) => ({
    "package.json": JSON.stringify({
      packageManager: "npm@10.0.0",
      scripts: { build: "npm run build", test: "npm test" },
    }),
    "package-lock.json": "{}",
  }[path] ?? null),
};

const post = (
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("public API server", () => {
  it("serves inspection, idempotent verification creation, and run polling", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-server-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts);
    const server = createApiServer({
      store,
      inspection: new InspectionService(inspectionGateway),
      orchestrator,
      bearerToken: "t".repeat(32),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const unauthorizedCallback = await fetch(
        `${baseUrl}/internal/v1/runs/018f47ac-5d7b-7c20-a1aa-0242ac120001/result`,
        { method: "PUT" },
      );
      expect(unauthorizedCallback.status).toBe(401);
      await expect(unauthorizedCallback.json()).resolves.toMatchObject({
        error: { code: "UNAUTHORIZED" },
      });

      const unknownHeartbeat = await fetch(
        `${baseUrl}/internal/v1/runs/018f47ac-5d7b-7c20-a1aa-0242ac120001/heartbeat`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${"t".repeat(32)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contractVersion: CONTRACT_VERSION,
            leaseId: "018f47ac-5d7b-7c20-a1aa-0242ac120002",
            observedAt: new Date().toISOString(),
            activeStage: null,
          }),
        },
      );
      expect(unknownHeartbeat.status).toBe(404);
      await expect(unknownHeartbeat.json()).resolves.toMatchObject({
        error: { code: "RUN_NOT_FOUND" },
      });

      const unknownResult = await fetch(
        `${baseUrl}/internal/v1/runs/018f47ac-5d7b-7c20-a1aa-0242ac120001/result`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${"t".repeat(32)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contractVersion: CONTRACT_VERSION,
            leaseId: "018f47ac-5d7b-7c20-a1aa-0242ac120002",
            completedAt: new Date().toISOString(),
            status: "SYSTEM_ERROR",
            report: null,
            systemError: {
              code: "RUNNER_FAILURE",
              message: "The runner could not complete this verification.",
              retryable: true,
            },
          }),
        },
      );
      expect(unknownResult.status).toBe(404);
      await expect(unknownResult.json()).resolves.toMatchObject({
        error: { code: "RUN_NOT_FOUND" },
      });

      for (const path of ["/api/runs/%ZZ", "/api/receipts/%ZZ"]) {
        const malformedPath = await fetch(`${baseUrl}${path}`);
        expect(malformedPath.status).toBe(400);
        await expect(malformedPath.json()).resolves.toMatchObject({
          error: { code: "INVALID_REQUEST", retryable: false },
        });
      }

      const malformedCallback = await fetch(
        `${baseUrl}/internal/v1/runs/%ZZ/heartbeat`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${"t".repeat(32)}` },
        },
      );
      expect(malformedCallback.status).toBe(400);
      await expect(malformedCallback.json()).resolves.toMatchObject({
        error: { code: "INVALID_REQUEST", retryable: false },
      });

      const inspection = await post(baseUrl, "/api/inspect", {
        contractVersion: CONTRACT_VERSION,
        repositoryUrl: request.repositoryUrl,
        ref: request.resolvedRef,
      });
      expect(inspection.status).toBe(200);
      expect(await inspection.json()).toMatchObject({
        supported: true,
        inspection: { resolvedCommitSha, packageManager: "npm" },
      });

      const missingKey = await post(baseUrl, "/api/verify", request);
      expect(missingKey.status).toBe(400);
      await expect(missingKey.json()).resolves.toMatchObject({
        error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
      });

      const created = await post(baseUrl, "/api/verify", request, {
        "idempotency-key": "run-1",
      });
      expect(created.status).toBe(202);
      const createdBody = await created.json() as {
        run: { id: string; status: string };
        replayed: boolean;
      };
      expect(createdBody).toMatchObject({
        replayed: false,
        run: { status: "RUNNING" },
      });
      expect(runner.dispatched).toHaveLength(1);

      const replay = await post(baseUrl, "/api/verify", request, {
        "idempotency-key": "run-1",
      });
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({
        replayed: true,
        run: { id: createdBody.run.id },
      });

      const conflict = await post(baseUrl, "/api/verify", { ...request, public: true }, {
        "idempotency-key": "run-1",
      });
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({
        error: { code: "IDEMPOTENCY_KEY_CONFLICT" },
      });

      const polled = await fetch(`${baseUrl}/api/runs/${createdBody.run.id}`);
      expect(polled.status).toBe(200);
      await expect(polled.json()).resolves.toMatchObject({
        id: createdBody.run.id,
        status: "RUNNING",
        verdict: null,
      });
    } finally {
      orchestrator.stop();
      store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns a generic retryable error for an operational API failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-server-error-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts);
    const server = createApiServer({
      store,
      inspection: new InspectionService(inspectionGateway),
      orchestrator,
      bearerToken: "t".repeat(32),
    });
    vi.spyOn(store, "get").mockImplementation(() => {
      throw new Error("postgres://internal-user:secret@db.internal/proof-runner");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/runs/018f47ac-5d7b-7c20-a1aa-0242ac120001`,
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        error: {
          code: "INTERNAL_ERROR",
          message: "The API could not process this request.",
          retryable: true,
        },
      });
      expect(JSON.stringify(body)).not.toContain("secret@db.internal");
    } finally {
      orchestrator.stop();
      store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("serves pre-rendered Open Graph HTML for demo receipts, live receipts, and 404 for missing receipts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-server-og-"));
    directories.push(directory);
    const store = new RunStore(join(directory, "runs.sqlite"));
    const runner = new RecordingRunner();
    const orchestrator = new Orchestrator(store, runner, receipts);
    const mockReceipts = {
      get: (id: string) =>
        id === "live-pass-1"
          ? { receipt: { payload: { report: { verdict: "PASS" } } } }
          : undefined,
      publicKey: () => undefined,
      verify: () => ({ valid: true }),
    };

    const server = createApiServer({
      store,
      inspection: new InspectionService(inspectionGateway),
      orchestrator,
      bearerToken: "t".repeat(32),
      receipts: mockReceipts,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");

    try {
      // 1. Demo receipt
      const demoResponse = await fetch(`http://127.0.0.1:${address.port}/receipts/passed`, {
        headers: { accept: "text/html", "x-forwarded-host": "proofrunner.org", "x-forwarded-proto": "https" },
      });
      expect(demoResponse.status).toBe(200);
      expect(demoResponse.headers.get("content-type")).toContain("text/html");
      const demoHtml = await demoResponse.text();
      expect(demoHtml).toContain('<meta property="og:title" content="[DEMO] PASS Verification Receipt (demo-fixed) · ProofRunner" />');
      expect(demoHtml).toContain('<meta property="og:description" content="Demo verification evidence for ever-guild/proof-runner at tag demo-fixed: All 5 demo checks passed in 12.4 seconds." />');
      expect(demoHtml).toContain('<meta property="og:url" content="https://proofrunner.org/receipts/passed" />');
      expect(demoHtml).toContain('<meta property="og:type" content="website" />');

      // 2. Unknown receipt returns 404
      const missingResponse = await fetch(`http://127.0.0.1:${address.port}/receipts/unknown-id-999`, {
        headers: { accept: "text/html", "x-forwarded-host": "proofrunner.org", "x-forwarded-proto": "https" },
      });
      expect(missingResponse.status).toBe(404);
      expect(missingResponse.headers.get("content-type")).toContain("text/html");
      const missingHtml = await missingResponse.text();
      expect(missingHtml).toContain('<meta property="og:title" content="Receipt Not Found · ProofRunner" />');
      expect(missingHtml).toContain('<meta property="og:description" content="Verification receipt unknown-id-999 was not found." />');
      expect(missingHtml).toContain('<meta property="og:url" content="https://proofrunner.org/receipts/unknown-id-999" />');

      // 3. Live receipt
      const liveResponse = await fetch(`http://127.0.0.1:${address.port}/receipts/live-pass-1`, {
        headers: { accept: "text/html", "x-forwarded-host": "proofrunner.org", "x-forwarded-proto": "https" },
      });
      expect(liveResponse.status).toBe(200);
      expect(liveResponse.headers.get("content-type")).toContain("text/html");
      const liveHtml = await liveResponse.text();
      expect(liveHtml).toContain('<meta property="og:title" content="Verification Receipt live-pass-1 · PASS · ProofRunner" />');
      expect(liveHtml).toContain('<meta property="og:description" content="Signed verification evidence receipt for run live-pass-1 with verdict PASS." />');
      expect(liveHtml).toContain('<meta property="og:url" content="https://proofrunner.org/receipts/live-pass-1" />');

    } finally {
      orchestrator.stop();
      store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
