/* eslint-disable @typescript-eslint/no-explicit-any -- integration assertions inspect runtime HTTP JSON. */
/**
 * PRVC Integration Test
 *
 * Starts the ProofRunner API server in-process with a simulated runner
 * that produces execution outcomes matching PRVC oracle expectations.
 * Validates that the full HTTP flow (inspect → verify → poll → receipt)
 * produces results matching each PRVC case's oracle.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jsyaml from "js-yaml";
import {
  CONTRACT_VERSION,
  type VerificationReport,
  type SignedReceipt,
} from "@ever-guild/proof-runner-schema";
import { createApiServer } from "../../../apps/api/src/server.js";
import {
  InspectionService,
  type InspectionGateway,
} from "../../../apps/api/src/inspection.js";
import {
  Orchestrator,
  type ReceiptIssuer,
} from "../../../apps/api/src/orchestration.js";
import { RunStore } from "../../../apps/api/src/store.js";
import { createRunnerServer } from "../../../apps/runner/src/server.js";
import { RunnerService } from "../../../apps/runner/src/service.js";
import { HttpRunnerClient } from "../../../apps/api/src/orchestration.js";
import type { RunnerConfig } from "../../../apps/runner/src/config.js";
import { generateAllCases } from "../src/generator.js";
import type { PrvcOracle } from "../src/types.js";

const sha = "b".repeat(40);
const hash = "a".repeat(64);
const bearerToken = "t".repeat(32);

/**
 * Maps a PRVC oracle to a simulated sandbox execution result.
 */
function buildReportForOracle(
  oracle: PrvcOracle,
  variantName: string,
  runId: string,
  verify: any,
): {
  status: "COMPLETED" | "TIMEOUT" | "SYSTEM_ERROR";
  systemError: { code: string; message: string; retryable: boolean } | null;
  report: VerificationReport | null;
} {
  const expected = oracle.variants[variantName]?.expected;
  if (!expected) {
    return {
      status: "SYSTEM_ERROR",
      systemError: { code: "ORACLE_MISSING", message: "No oracle variant", retryable: false },
      report: null,
    };
  }

  const ts = expected.terminal_status;
  // ProofRunner schema only supports COMPLETED/TIMEOUT/SYSTEM_ERROR as terminal
  if (ts !== "COMPLETED" && ts !== "TIMEOUT") {
    return {
      status: "SYSTEM_ERROR",
      systemError: { code: expected.reason_code, message: `PRVC: ${ts}`, retryable: false },
      report: null,
    };
  }

  const completedAt = new Date().toISOString();
  const checks: VerificationReport["checks"] = [];

  if (expected.verdict === "PASS") {
    checks.push({
      id: "test", stage: "TEST", title: "Run tests", outcome: "PASSED",
      startedAt: completedAt, completedAt, durationMs: 50, exitCode: 0,
      summary: "All tests passed",
    });
  } else if (expected.verdict === "FAIL") {
    const failMsg = expected.tests?.failing_exact?.[0] ?? "test failure";
    checks.push({
      id: "test", stage: "TEST", title: "Run tests", outcome: "FAILED",
      startedAt: completedAt, completedAt, durationMs: 50, exitCode: 1,
      summary: failMsg,
    });
  } else {
    checks.push({
      id: "test", stage: "TEST", title: "Run tests", outcome: "SKIPPED",
      startedAt: completedAt, completedAt, durationMs: 0, exitCode: null,
      summary: expected.reason_code,
    });
  }

  return {
    status: ts,
    systemError: null,
    report: {
      contractVersion: CONTRACT_VERSION,
      runId,
      repositoryUrl: verify.repositoryUrl,
      resolvedCommitSha: verify.resolvedCommitSha,
      resolvedRef: verify.resolvedRef,
      skill: verify.skill,
      runtimeImageDigest: `sha256:${"0".repeat(64)}`,
      verdict: expected.verdict as "PASS" | "FAIL" | "INCONCLUSIVE",
      checks,
      durationMs: 50,
      completedAt,
      reasonCode: expected.reason_code === "NONE" ? null : expected.reason_code,
    },
  };
}

describe("PRVC Integration: Smoke Cases via ProofRunner HTTP API", () => {
  const corpusDir = join(__dirname, "..");
  let apiBase: string;
  let apiServer: ReturnType<typeof createApiServer>;
  let runnerServer: ReturnType<typeof createRunnerServer>;
  let store: RunStore;
  let orchestrator: Orchestrator;
  let tmpDir: string;
  let caseOracles: Map<string, PrvcOracle>;
  let smokeCases: string[];

  // Track which caseId/variant each submitted run maps to
  const runOracleMap = new Map<string, { oracle: PrvcOracle; variant: string }>();
  let commitSequence = 0;

  const registerOracle = (caseId: string, variant: string) => {
    const oracle = caseOracles.get(caseId);
    if (!oracle) throw new Error(`Missing oracle for ${caseId}`);

    const commitSha = (++commitSequence).toString(16).padStart(40, "0");
    runOracleMap.set(commitSha, { oracle, variant });
    return { oracle, commitSha };
  };

  beforeAll(async () => {
    // Generate corpus
    generateAllCases(corpusDir);

    // Load smoke suite and oracles
    const smokeContent = readFileSync(join(corpusDir, "suites", "smoke.yaml"), "utf8");
    const smokeObj = jsyaml.load(smokeContent) as { cases: string[] };
    smokeCases = smokeObj.cases;

    caseOracles = new Map();
    for (const caseId of smokeCases) {
      const oracleFile = join(corpusDir, "cases", caseId, "oracle.yaml");
      caseOracles.set(caseId, jsyaml.load(readFileSync(oracleFile, "utf8")) as PrvcOracle);
    }

    // Setup temp dir
    tmpDir = mkdtempSync(join(tmpdir(), "prvc-integration-"));

    // Setup store
    store = new RunStore(join(tmpDir, "runs.sqlite"));

    // Inspection gateway — returns synthetic metadata
    const gateway: InspectionGateway = {
      resolve: async () => sha,
      file: async (_url, _sha, path) =>
        ({
          "package.json": JSON.stringify({
            scripts: { build: "echo build", test: "echo test" },
            devDependencies: { typescript: "5" },
          }),
          "package-lock.json": "{}",
          "tsconfig.json": "{}",
        })[path] ?? null,
    };

    // Receipt issuer
    const receipts: ReceiptIssuer = {
      issue(report: VerificationReport): SignedReceipt {
        return {
          contractVersion: CONTRACT_VERSION,
          payload: {
            contractVersion: CONTRACT_VERSION,
            id: report.runId,
            report,
            createdAt: report.completedAt,
          },
          canonicalization: "JCS-RFC8785",
          hashAlgorithm: "SHA-256",
          payloadHash: "f".repeat(64),
          signatureAlgorithm: "Ed25519",
          keyId: "prvc-test",
          signature: `${"A".repeat(86)}==`,
        };
      },
    };

    // Create runner with a custom sandbox executor
    const runnerConfig: RunnerConfig = {
      host: "127.0.0.1",
      port: 0,
      bearerToken,
      apiCallbackUrl: "", // will be set after API starts
      leaseExtensionMs: 30_000,
      runtimeImage: "unused",
      proxyImage: "unused",
      workspaceRoot: tmpDir,
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

    // Custom sandbox executor that uses PRVC oracles
    const sandboxExecutor = {
      execute: async (
        runId: string,
        verify: any,
        controls: { onStage: (stage: string) => void },
      ) => {
        controls.onStage("TEST");
        await new Promise((r) => setTimeout(r, 20));

        // Find the oracle for this run
        const mapping = runOracleMap.get(runId) ?? runOracleMap.get(verify.resolvedCommitSha);
        if (!mapping) {
          return {
            status: "SYSTEM_ERROR" as const,
            systemError: { code: "NO_ORACLE", message: "No oracle mapping", retryable: false },
            report: null,
          };
        }

        return buildReportForOracle(mapping.oracle, mapping.variant, runId, verify);
      },
    };

    // Start runner
    const runnerClientHolder: { value?: InstanceType<typeof HttpRunnerClient> } = {};

    orchestrator = new Orchestrator(
      store,
      {
        dispatch: (body) => runnerClientHolder.value!.dispatch(body),
        cancel: (id) => runnerClientHolder.value!.cancel(id),
      },
      receipts,
      30_000,
    );

    // Start API server
    apiServer = createApiServer({
      store,
      inspection: new InspectionService(gateway),
      orchestrator,
      bearerToken,
    });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    const apiAddr = apiServer.address();
    if (!apiAddr || typeof apiAddr === "string") throw new Error("missing API address");
    apiBase = `http://127.0.0.1:${apiAddr.port}`;

    // Now start runner server with correct API callback URL
    runnerConfig.apiCallbackUrl = apiBase;
    runnerServer = createRunnerServer(
      runnerConfig,
      new RunnerService(runnerConfig, sandboxExecutor),
    );
    await new Promise<void>((resolve) => runnerServer.listen(0, "127.0.0.1", resolve));
    const runnerAddr = runnerServer.address();
    if (!runnerAddr || typeof runnerAddr === "string") throw new Error("missing runner address");
    runnerClientHolder.value = new HttpRunnerClient(
      `http://127.0.0.1:${runnerAddr.port}`,
      bearerToken,
    );

    orchestrator.start();
  });

  afterAll(async () => {
    orchestrator.stop();
    store.close();
    await new Promise<void>((r) => runnerServer.close(() => r()));
    await new Promise<void>((r) => apiServer.close(() => r()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Tests ---

  it("POST /api/inspect returns supported:true for synthetic repo", async () => {
    const res = await fetch(`${apiBase}/api/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contractVersion: CONTRACT_VERSION,
        repositoryUrl: "https://github.com/acme/example",
        ref: { type: "commit", value: sha },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.supported).toBe(true);
    expect(body.inspection.selectedSkill).toBe("node-typescript@1");
  });

  it("end-to-end PASS case: submit → dispatch → result → receipt", async () => {
    const caseId = "prvc.synthetic.node.core-pass-001";
    const { oracle, commitSha } = registerOracle(caseId, "default");

    // Submit
    const verifyRes = await fetch(`${apiBase}/api/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `e2e-${caseId}`,
      },
      body: JSON.stringify({
        contractVersion: CONTRACT_VERSION,
        repositoryUrl: "https://github.com/acme/example",
        resolvedCommitSha: commitSha,
        resolvedRef: { type: "commit", value: commitSha },
        skill: { name: "node-typescript", version: "1", hash },
        public: false,
      }),
    });
    expect(verifyRes.status).toBe(202);
    const { run } = (await verifyRes.json()) as any;
    const runId = run.id;
    runOracleMap.set(runId, { oracle, variant: "default" });

    // Wait for runner to process
    await new Promise((r) => setTimeout(r, 300));

    // Poll result
    const runRes = await fetch(`${apiBase}/api/runs/${runId}`);
    expect(runRes.status).toBe(200);
    const runBody = (await runRes.json()) as any;

    expect(runBody.status).toBe("COMPLETED");
    expect(runBody.verdict).toBe("PASS");
    expect(runBody.report.checks[0].outcome).toBe("PASSED");

    // Verify run response includes receipt link
    expect(runBody.links.receipt).toBe(`/api/receipts/${runId}`);
  });

  it("end-to-end FAIL case: test failure detected", async () => {
    const caseId = "prvc.synthetic.node.core-fail-test-003";
    const { oracle, commitSha } = registerOracle(caseId, "default");

    const verifyRes = await fetch(`${apiBase}/api/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `e2e-${caseId}`,
      },
      body: JSON.stringify({
        contractVersion: CONTRACT_VERSION,
        repositoryUrl: "https://github.com/acme/example",
        resolvedCommitSha: commitSha,
        resolvedRef: { type: "commit", value: commitSha },
        skill: { name: "node-typescript", version: "1", hash },
        public: false,
      }),
    });
    expect(verifyRes.status).toBe(202);
    const { run } = (await verifyRes.json()) as any;
    runOracleMap.set(run.id, { oracle, variant: "default" });

    await new Promise((r) => setTimeout(r, 300));

    const runRes = await fetch(`${apiBase}/api/runs/${run.id}`);
    const runBody = (await runRes.json()) as any;
    expect(runBody.status).toBe("COMPLETED");
    expect(runBody.verdict).toBe("FAIL");
    expect(runBody.report.reasonCode).toBe("TEST_FAILURE");
  });

  it("end-to-end SYSTEM_ERROR case: sandbox policy block", async () => {
    const caseId = "prvc.synthetic.node.sandbox-secret-env-017";
    const { oracle, commitSha } = registerOracle(caseId, "default");

    const verifyRes = await fetch(`${apiBase}/api/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `e2e-${caseId}`,
      },
      body: JSON.stringify({
        contractVersion: CONTRACT_VERSION,
        repositoryUrl: "https://github.com/acme/example",
        resolvedCommitSha: commitSha,
        resolvedRef: { type: "commit", value: commitSha },
        skill: { name: "node-typescript", version: "1", hash },
        public: false,
      }),
    });
    expect(verifyRes.status).toBe(202);
    const { run } = (await verifyRes.json()) as any;
    runOracleMap.set(run.id, { oracle, variant: "default" });

    await new Promise((r) => setTimeout(r, 300));

    const runRes = await fetch(`${apiBase}/api/runs/${run.id}`);
    const runBody = (await runRes.json()) as any;
    expect(runBody.status).toBe("SYSTEM_ERROR");
    expect(runBody.verdict).toBe("INCONCLUSIVE");
  });

  it("idempotency replay returns same run", async () => {
    const key = "prvc-idempotency-replay";
    const request = {
      contractVersion: CONTRACT_VERSION,
      repositoryUrl: "https://github.com/acme/example",
      resolvedCommitSha: sha,
      resolvedRef: { type: "commit", value: sha },
      skill: { name: "node-typescript", version: "1", hash },
      public: false,
    };
    const first = await fetch(`${apiBase}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(request),
    });
    const firstBody = (await first.json()) as any;

    const replay = await fetch(`${apiBase}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(request),
    });
    const replayBody = (await replay.json()) as any;

    expect(replayBody.replayed).toBe(true);
    expect(replayBody.run.id).toBe(firstBody.run.id);
  });

  it("GET /api/runs/:id returns 404 for unknown run", async () => {
    const res = await fetch(`${apiBase}/api/runs/00000000-0000-4000-8000-000000000000`);
    expect(res.status).toBe(404);
  });

  it("GET /api/receipts/:id returns 404 for unknown receipt", async () => {
    const res = await fetch(`${apiBase}/api/receipts/00000000-0000-4000-8000-000000000000`);
    expect(res.status).toBe(404);
  });
});
