/* eslint-disable @typescript-eslint/no-explicit-any -- black-box API responses are validated at runtime. */
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "node:crypto";
import { hashCanonicalJson } from "./jcs.js";
import type { PrvcOracle, RunStatus, Verdict } from "./types.js";
import { PrvcValidator } from "./validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface VerificationReportInput {
  contractVersion: "1.0";
  runId: string;
  repositoryUrl: string;
  resolvedCommitSha: string;
  skill: {
    name: "node-typescript";
    version: "1";
    hash: string;
  };
  runtimeImageDigest: string;
  verdict: Verdict;
  checks: Array<{
    id: string;
    stage: string;
    title: string;
    outcome: string;
    summary: string;
  }>;
  durationMs: number;
  completedAt: string;
  reasonCode: string | null;
}

export interface SignedReceiptInput {
  contractVersion: "1.0";
  payload: {
    contractVersion: "1.0";
    id: string;
    report: VerificationReportInput;
    createdAt: string;
  };
  canonicalization: "JCS-RFC8785";
  hashAlgorithm: "SHA-256";
  payloadHash: string;
  signatureAlgorithm: "Ed25519";
  keyId: string;
  signature: string;
}

export interface BlackBoxExecuteOptions {
  baseUrl: string;
  repositoryUrl: string;
  commitSha: string;
  refType?: "commit" | "branch" | "tag";
  refValue?: string;
  idempotencyKey: string;
  inspectFirst?: boolean;
  fetchFn?: typeof fetch;
}

export class ReferenceHarness {
  private validator: PrvcValidator;
  private readonly cases: Map<string, { variants: Set<string>; suites: Set<string> }>;

  constructor(baseDir?: string) {
    const corpusDir = baseDir || join(__dirname, "..");
    this.validator = new PrvcValidator(corpusDir);
    this.cases = new Map();
    const indexPath = join(corpusDir, "index", "cases.jsonl");
    if (existsSync(indexPath)) {
      for (const line of readFileSync(indexPath, "utf8").trim().split("\n")) {
        if (!line) continue;
        const entry = JSON.parse(line) as {
          case_id: string;
          suite: string[];
          variants: Record<string, unknown>;
        };
        this.cases.set(entry.case_id, {
          variants: new Set(Object.keys(entry.variants)),
          suites: new Set(entry.suite),
        });
      }
    }
  }

  /**
   * Evaluates a report against a PRVC oracle variant, including stage outcomes, minimum executed tests, and required passing/failing tests.
   */
  public evaluateReport(
    oracle: PrvcOracle,
    variantName: string,
    report: VerificationReportInput,
    terminalStatus: RunStatus
  ): { passed: boolean; discrepancies: string[] } {
    const discrepancies: string[] = [];
    const variantOracle = oracle.variants[variantName];
    if (!variantOracle) {
      return { passed: false, discrepancies: [`Variant '${variantName}' not found in oracle`] };
    }

    const expected = variantOracle.expected;

    if (terminalStatus !== expected.terminal_status) {
      discrepancies.push(
        `Terminal status mismatch: expected ${expected.terminal_status}, got ${terminalStatus}`
      );
    }

    if (report.verdict !== expected.verdict) {
      discrepancies.push(
        `Verdict mismatch: expected ${expected.verdict}, got ${report.verdict}`
      );
    }

    const reportReason = report.reasonCode ?? "NONE";
    if (reportReason !== expected.reason_code) {
      discrepancies.push(
        `Reason code mismatch: expected ${expected.reason_code}, got ${reportReason}`
      );
    }

    // Check minimum executed tests
    if (expected.tests?.minimum_executed !== undefined) {
      if (report.checks.length < expected.tests.minimum_executed) {
        discrepancies.push(
          `Minimum executed tests threshold failed: expected >= ${expected.tests.minimum_executed}, got ${report.checks.length}`
        );
      }
    }

    // Check required passing tests
    if (expected.tests?.required_passing) {
      const passedCheckSummaries = report.checks
        .filter((c) => c.outcome === "PASSED")
        .map((c) => c.summary);
      for (const reqPass of expected.tests.required_passing) {
        const found = passedCheckSummaries.some((s) => s.includes(reqPass));
        if (!found) {
          discrepancies.push(`Required passing test '${reqPass}' not found or did not pass in report checks`);
        }
      }
    }

    // Check failing exact tests
    if (expected.tests?.failing_exact) {
      const failedCheckSummaries = report.checks
        .filter((c) => c.outcome === "FAILED")
        .map((c) => c.summary);
      for (const expectedFail of expected.tests.failing_exact) {
        const found = failedCheckSummaries.some((s) => s.includes(expectedFail));
        if (!found) {
          discrepancies.push(`Expected failing test '${expectedFail}' not found in report checks`);
        }
      }
    }

    // Check expected stage outcomes
    if (expected.stages) {
      for (const [stageName, stageOracle] of Object.entries(expected.stages)) {
        const check = report.checks.find((c) => c.stage === stageName || c.id === stageName);
        if (!check) {
          discrepancies.push(`Expected stage '${stageName}' not found in report checks`);
        } else if (check.outcome !== stageOracle.status) {
          discrepancies.push(`Stage '${stageName}' outcome mismatch: expected ${stageOracle.status}, got ${check.outcome}`);
        }
      }
    }

    return { passed: discrepancies.length === 0, discrepancies };
  }

  /**
   * Validates a signed receipt's integrity using RFC 8785 canonical hashing and optional Ed25519 signature check.
   */
  public validateReceiptIntegrity(
    receipt: SignedReceiptInput,
    publicKeyPem?: string
  ): {
    valid: boolean;
    reason: string | null;
  } {
    if (receipt.canonicalization !== "JCS-RFC8785") {
      return { valid: false, reason: "Unsupported canonicalization scheme" };
    }
    if (receipt.hashAlgorithm !== "SHA-256") {
      return { valid: false, reason: "Unsupported hash algorithm" };
    }

    const calculatedHash = hashCanonicalJson(receipt.payload);
    if (calculatedHash !== receipt.payloadHash) {
      return { valid: false, reason: "PAYLOAD_HASH_MISMATCH" };
    }

    if (!receipt.signature || receipt.signature.length < 10) {
      return { valid: false, reason: "INVALID_SIGNATURE" };
    }

    if (publicKeyPem) {
      try {
        const signatureBuf = Buffer.from(receipt.signature, "hex");
        const isValidSig = verify(null, Buffer.from(receipt.payloadHash, "utf8"), publicKeyPem, signatureBuf);
        if (!isValidSig) {
          return { valid: false, reason: "INVALID_SIGNATURE" };
        }
      } catch {
        return { valid: false, reason: "INVALID_SIGNATURE" };
      }
    }

    return { valid: true, reason: null };
  }

  /**
   * Executes a Black-Box verification against ProofRunner HTTP API endpoints (/api/inspect, /api/verify, /api/runs, /api/receipts).
   */
  public async executeBlackBoxVerification(options: BlackBoxExecuteOptions): Promise<{
    inspected?: boolean;
    runId: string;
    terminalStatus: RunStatus;
    report: VerificationReportInput | null;
    receipt: SignedReceiptInput | null;
  }> {
    const fetchImpl = options.fetchFn || globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("fetch implementation required for black-box API execution");
    }

    let inspected = false;
    // Optional inspection call
    if (options.inspectFirst) {
      const inspectRes = await fetchImpl(`${options.baseUrl}/api/inspect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: "1.0",
          repositoryUrl: options.repositoryUrl,
          ref: {
            type: options.refType || "commit",
            value: options.refValue || options.commitSha,
          },
        }),
      });
      inspected = inspectRes.ok;
    }

    // 1. Submit verify request
    const verifyRes = await fetchImpl(`${options.baseUrl}/api/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": options.idempotencyKey,
      },
      body: JSON.stringify({
        contractVersion: "1.0",
        repositoryUrl: options.repositoryUrl,
        resolvedCommitSha: options.commitSha,
        resolvedRef: {
          type: options.refType || "commit",
          value: options.refValue || options.commitSha,
        },
        skill: {
          name: "node-typescript",
          version: "1",
          hash: "0000000000000000000000000000000000000000000000000000000000000000",
        },
        public: false,
      }),
    });

    const verifyJson = (await verifyRes.json()) as any;
    const runId = verifyJson.run?.id || verifyJson.id;

    // 2. Poll for terminal state (including all vocabulary terminal statuses)
    let runData = verifyJson.run || verifyJson;
    const terminalStates: RunStatus[] = [
      "COMPLETED",
      "TIMEOUT",
      "SYSTEM_ERROR",
      "RESOURCE_EXHAUSTED",
      "POLICY_BLOCKED",
      "CANCELLED",
      "REJECTED",
    ];

    while (!terminalStates.includes(runData.status)) {
      await new Promise((res) => setTimeout(res, 200));
      const pollRes = await fetchImpl(`${options.baseUrl}/api/runs/${runId}`);
      runData = (await pollRes.json()) as any;
    }

    // 3. Fetch receipt if available
    let receipt: SignedReceiptInput | null = null;
    if (runData.links?.receipt) {
      const receiptRes = await fetchImpl(`${options.baseUrl}${runData.links.receipt}`);
      if (receiptRes.ok) {
        receipt = (await receiptRes.json()) as SignedReceiptInput;
      }
    }

    return {
      inspected,
      runId,
      terminalStatus: runData.status,
      report: runData.report || null,
      receipt,
    };
  }

  /**
   * Materializes a case-specific fixture repository matching the oracle requirements.
   */
  public materializeFixture(caseId: string, variantName: string, targetDir: string): void {
    const definition = this.cases.get(caseId);
    if (!definition || !definition.variants.has(variantName)) {
      throw new Error(`Unknown PRVC case/variant: ${caseId}/${variantName}`);
    }
    if (caseId.includes("real.")) {
      throw new Error(
        `Cannot materialize ${caseId}: imported candidate cases require source provenance and a reproducible recipe.`,
      );
    }

    // Policy, resource, and cancellation cases have to be driven by the
    // target runner's container, cgroup, controlled-egress, and supervisor
    // adapters. Generic Node commands cannot truthfully manufacture their
    // product-native terminal status, so the reference harness refuses to
    // produce false certification input.
    if (definition.suites.has("sandbox")) {
      throw new Error(
        `Cannot materialize ${caseId}: sandbox cases require a target-runner adapter and live execution evidence.`,
      );
    }

    mkdirSync(targetDir, { recursive: true });

    if (caseId === "prvc.synthetic.node.core-empty-repo-010") {
      // Empty directory
      return;
    }

    if (caseId === "prvc.synthetic.node.core-fail-lockfile-006") {
      writeFileSync(join(targetDir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2), "utf8");
      writeFileSync(join(targetDir, "package-lock.json"), "INVALID_JSON_LOCKFILE_SYNTAX {{{", "utf8");
      return;
    }

    if (caseId === "prvc.synthetic.node.core-missing-script-009") {
      writeFileSync(join(targetDir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2), "utf8");
      return;
    }

    let testCmd = "node -e 'process.exit(0)'";
    let buildCmd = "node -e 'process.exit(0)'";

    if (caseId === "prvc.synthetic.node.core-fail-test-003") {
      testCmd = "node -e 'console.error(\"FAIL: test/auth.test.js::Auth::rejects invalid token\"); process.exit(1)'";
    } else if (caseId === "prvc.synthetic.node.core-no-tests-req-007") {
      testCmd = "node -e 'console.error(\"NO_TESTS_DISCOVERED: 0 tests found\"); process.exit(1)'";
    } else if (caseId === "prvc.synthetic.node.core-fail-build-004") {
      buildCmd = "node -e 'console.error(\"TypeScript build compilation error\"); process.exit(1)'";
    } else if (caseId === "prvc.synthetic.node.core-fail-typecheck-005") {
      buildCmd = "node -e 'console.error(\"Type check failed: Type string is not assignable to number\"); process.exit(1)'";
    }

    const pkgJson = {
      name: `prvc-fixture-${caseId}`,
      version: "1.0.0",
      scripts: {
        build: buildCmd,
        test: testCmd,
      },
    };

    writeFileSync(join(targetDir, "package.json"), JSON.stringify(pkgJson, null, 2), "utf8");
    writeFileSync(join(targetDir, "package-lock.json"), JSON.stringify({ name: pkgJson.name, version: pkgJson.version, lockfileVersion: 3 }, null, 2), "utf8");
  }

  /**
   * Verifies that host workspace and temporary runner directories are cleaned up post-execution.
   */
  public verifySandboxTeardown(workspacesDir: string, runId: string): { clean: boolean; residualFiles: string[] } {
    if (!existsSync(workspacesDir)) {
      return { clean: true, residualFiles: [] };
    }
    const entries = readdirSync(workspacesDir);
    const leaks = entries.filter((name) => name.includes(runId));
    return { clean: leaks.length === 0, residualFiles: leaks };
  }
}
