import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  type InternalDispatchRequest,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
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

describe("terminal callback delivery", () => {
  it("retries a transient API callback failure and retains the terminal result", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-callback-retry-"));
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
      5_000,
    );
    const api = createApiServer({
      store,
      inspection: new InspectionService(inspectionGateway),
      orchestrator,
      bearerToken: token,
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const apiAddress = api.address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${apiAddress.port}`;
    let resultCalls = 0;
    const callbackProxy = createServer(async (incoming, outgoing) => {
      const body: Buffer[] = [];
      for await (const chunk of incoming) {
        body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      if (
        incoming.method === "PUT" &&
        /^\/internal\/v1\/runs\/[^/]+\/result$/.test(incoming.url ?? "")
      ) {
        resultCalls += 1;
        if (resultCalls === 1) {
          const failure = JSON.stringify({
            contractVersion: CONTRACT_VERSION,
            error: {
              code: "INTERNAL_ERROR",
              message: "Temporary callback failure.",
              retryable: true,
            },
          });
          outgoing.writeHead(503, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(failure),
          });
          outgoing.end(failure);
          return;
        }
      }

      const upstream = await fetch(`${apiUrl}${incoming.url ?? "/"}`, {
        method: incoming.method,
        headers: {
          authorization: typeof incoming.headers.authorization === "string"
            ? incoming.headers.authorization
            : "",
          "content-type": typeof incoming.headers["content-type"] === "string"
            ? incoming.headers["content-type"]
            : "application/json",
        },
        body: body.length > 0 ? Buffer.concat(body) : undefined,
      });
      const response = Buffer.from(await upstream.arrayBuffer());
      outgoing.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "content-length": response.byteLength,
      });
      outgoing.end(response);
    });
    await new Promise<void>((resolve) => callbackProxy.listen(0, "127.0.0.1", resolve));
    const callbackAddress = callbackProxy.address() as AddressInfo;
    const runnerConfig: RunnerConfig = {
      host: "127.0.0.1",
      port: 0,
      bearerToken: token,
      apiCallbackUrl: `http://127.0.0.1:${callbackAddress.port}/`,
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
    const runner = createRunnerServer(
      runnerConfig,
      new RunnerService(runnerConfig, {
        execute: async () => ({
          status: "SYSTEM_ERROR",
          report: null,
          systemError: {
            code: "RUNNER_FAILURE",
            message: "The sandbox failed once.",
            retryable: true,
          },
        }),
      }),
    );
    await new Promise<void>((resolve) => runner.listen(0, "127.0.0.1", resolve));
    const runnerAddress = runner.address() as AddressInfo;
    runnerClient = new HttpRunnerClient(
      `http://127.0.0.1:${runnerAddress.port}/`,
      token,
    );
    const created = store.create("callback-retry", request);
    if (created.kind !== "created") throw new Error("expected a queued run");
    orchestrator.start();

    try {
      await vi.waitFor(() => {
        expect(resultCalls).toBe(2);
        expect(store.get(created.run.response.id)?.response).toMatchObject({
          status: "SYSTEM_ERROR",
          systemError: { code: "RUNNER_FAILURE" },
        });
      });
    } finally {
      orchestrator.stop();
      await close(runner);
      await close(callbackProxy);
      await close(api);
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
