/* eslint-disable @typescript-eslint/no-explicit-any -- mock HTTP responses deliberately model untyped wire JSON. */
import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { ReferenceHarness, type VerificationReportInput, type SignedReceiptInput } from "../src/harness.js";
import { hashCanonicalJson, canonicalizeJson } from "../src/jcs.js";
import type { PrvcOracle } from "../src/types.js";

describe("Reference Harness & Protocol Validation", () => {
  const harness = new ReferenceHarness(join(__dirname, ".."));

  it("should format JSON canonically ignoring undefined properties", () => {
    const raw = { a: 1, b: undefined, c: "test" };
    const canonical = canonicalizeJson(raw);
    expect(canonical).toBe('{"a":1,"c":"test"}');
  });

  it("should evaluate report matching expected PASS oracle with stages and minimum executed checks", () => {
    const oracle: PrvcOracle = {
      schema_version: "prvc.oracle/v1",
      case_id: "prvc.synthetic.node.javascript.core-pass-001",
      variants: {
        default: {
          expected: {
            terminal_status: "COMPLETED",
            verdict: "PASS",
            reason_code: "NONE",
            tests: { minimum_executed: 1, required_passing: ["All tests passed"] },
            stages: { TEST: { status: "PASSED" } },
          },
        },
      },
    };

    const report: VerificationReportInput = {
      contractVersion: "1.0",
      runId: "11111111-1111-4111-8111-111111111111",
      repositoryUrl: "https://github.com/example/repo",
      resolvedCommitSha: "1111111111111111111111111111111111111111",
      skill: { name: "node-typescript", version: "1", hash: "0000000000000000000000000000000000000000000000000000000000000000" },
      runtimeImageDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      verdict: "PASS",
      checks: [
        { id: "TEST", stage: "TEST", title: "Run tests", outcome: "PASSED", summary: "All tests passed" },
      ],
      durationMs: 1200,
      completedAt: "2026-07-24T00:00:00.000Z",
      reasonCode: null,
    };

    const evalResult = harness.evaluateReport(oracle, "default", report, "COMPLETED");
    expect(evalResult.passed).toBe(true);
    expect(evalResult.discrepancies).toEqual([]);
  });

  it("should fail evaluateReport when required passing test is missing or minimum executed threshold fails", () => {
    const oracle: PrvcOracle = {
      schema_version: "prvc.oracle/v1",
      case_id: "prvc.synthetic.node.javascript.core-pass-001",
      variants: {
        default: {
          expected: {
            terminal_status: "COMPLETED",
            verdict: "PASS",
            reason_code: "NONE",
            tests: { minimum_executed: 3, required_passing: ["Required Test A"] },
          },
        },
      },
    };

    const report: VerificationReportInput = {
      contractVersion: "1.0",
      runId: "11111111-1111-4111-8111-111111111111",
      repositoryUrl: "https://github.com/example/repo",
      resolvedCommitSha: "1111111111111111111111111111111111111111",
      skill: { name: "node-typescript", version: "1", hash: "0000000000000000000000000000000000000000000000000000000000000000" },
      runtimeImageDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      verdict: "PASS",
      checks: [
        { id: "TEST", stage: "TEST", title: "Run tests", outcome: "PASSED", summary: "Other Test" },
      ],
      durationMs: 1200,
      completedAt: "2026-07-24T00:00:00.000Z",
      reasonCode: null,
    };

    const evalResult = harness.evaluateReport(oracle, "default", report, "COMPLETED");
    expect(evalResult.passed).toBe(false);
    expect(evalResult.discrepancies.some((d) => d.includes("Minimum executed tests threshold failed"))).toBe(true);
    expect(evalResult.discrepancies.some((d) => d.includes("Required passing test 'Required Test A' not found"))).toBe(true);
  });

  it("should detect discrepancy when expected FAIL receives PASS report (False PASS prevention)", () => {
    const oracle: PrvcOracle = {
      schema_version: "prvc.oracle/v1",
      case_id: "prvc.synthetic.node.javascript.core-fail-test-003",
      variants: {
        default: {
          expected: {
            terminal_status: "COMPLETED",
            verdict: "FAIL",
            reason_code: "TEST_FAILURE",
          },
        },
      },
    };

    const report: VerificationReportInput = {
      contractVersion: "1.0",
      runId: "11111111-1111-4111-8111-111111111111",
      repositoryUrl: "https://github.com/example/repo",
      resolvedCommitSha: "1111111111111111111111111111111111111111",
      skill: { name: "node-typescript", version: "1", hash: "0000000000000000000000000000000000000000000000000000000000000000" },
      runtimeImageDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      verdict: "PASS",
      checks: [
        { id: "test", stage: "TEST", title: "Run tests", outcome: "PASSED", summary: "All tests passed" },
      ],
      durationMs: 1200,
      completedAt: "2026-07-24T00:00:00.000Z",
      reasonCode: null,
    };

    const evalResult = harness.evaluateReport(oracle, "default", report, "COMPLETED");
    expect(evalResult.passed).toBe(false);
    expect(evalResult.discrepancies).toContain("Verdict mismatch: expected FAIL, got PASS");
  });

  it("should validate receipt integrity with RFC 8785 canonical hash", () => {
    const payload = {
      contractVersion: "1.0" as const,
      id: "22222222-2222-4222-8222-222222222222",
      report: {
        contractVersion: "1.0" as const,
        runId: "22222222-2222-4222-8222-222222222222",
        repositoryUrl: "https://github.com/example/repo",
        resolvedCommitSha: "1111111111111111111111111111111111111111",
        skill: { name: "node-typescript" as const, version: "1" as const, hash: "0000000000000000000000000000000000000000000000000000000000000000" },
        runtimeImageDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        verdict: "PASS" as const,
        checks: [{ id: "test", stage: "TEST", title: "Test", outcome: "PASSED", summary: "Passed" }],
        durationMs: 1000,
        completedAt: "2026-07-24T00:00:00.000Z",
        reasonCode: null,
      },
      createdAt: "2026-07-24T00:00:00.000Z",
    };

    const payloadHash = hashCanonicalJson(payload);

    const validReceipt: SignedReceiptInput = {
      contractVersion: "1.0",
      payload,
      canonicalization: "JCS-RFC8785",
      hashAlgorithm: "SHA-256",
      payloadHash,
      signatureAlgorithm: "Ed25519",
      keyId: "key-1",
      signature: "valid-mock-ed25519-signature-string",
    };

    const valResult = harness.validateReceiptIntegrity(validReceipt);
    expect(valResult.valid).toBe(true);

    // Tamper payload commit SHA
    const tamperedPayload = {
      ...payload,
      report: {
        ...payload.report,
        resolvedCommitSha: "3333333333333333333333333333333333333333",
      },
    };

    const tamperedReceipt: SignedReceiptInput = {
      ...validReceipt,
      payload: tamperedPayload,
    };

    const tamperResult = harness.validateReceiptIntegrity(tamperedReceipt);
    expect(tamperResult.valid).toBe(false);
    expect(tamperResult.reason).toBe("PAYLOAD_HASH_MISMATCH");
  });

  it("should execute black-box verification flow including optional inspect endpoint", async () => {
    const runId = "33333333-3333-4333-8333-333333333333";
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/inspect")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              contractVersion: "1.0",
              supported: true,
              inspection: {
                packageManager: "pnpm",
                selectedSkill: "node-typescript@1",
              },
            }),
        });
      }
      if (url.endsWith("/api/verify")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              contractVersion: "1.0",
              run: {
                id: runId,
                status: "COMPLETED",
                verdict: "PASS",
                links: { self: `/api/runs/${runId}`, receipt: `/api/receipts/${runId}` },
                report: {
                  contractVersion: "1.0",
                  runId,
                  repositoryUrl: "https://github.com/example/repo",
                  resolvedCommitSha: "1111111111111111111111111111111111111111",
                  skill: { name: "node-typescript", version: "1", hash: "0000000000000000000000000000000000000000000000000000000000000000" },
                  runtimeImageDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                  verdict: "PASS",
                  checks: [{ id: "test", stage: "TEST", title: "Test", outcome: "PASSED", summary: "Passed" }],
                  durationMs: 500,
                  completedAt: "2026-07-24T00:00:00.000Z",
                  reasonCode: null,
                },
              },
            }),
        });
      }
      if (url.endsWith(`/api/receipts/${runId}`)) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              contractVersion: "1.0",
              payload: { id: runId, createdAt: "2026-07-24T00:00:00.000Z" },
              canonicalization: "JCS-RFC8785",
              hashAlgorithm: "SHA-256",
              payloadHash: "0000000000000000000000000000000000000000000000000000000000000000",
              signatureAlgorithm: "Ed25519",
              keyId: "k1",
              signature: "sig",
            }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    const res = await harness.executeBlackBoxVerification({
      baseUrl: "http://localhost:3000",
      repositoryUrl: "https://github.com/example/repo",
      commitSha: "1111111111111111111111111111111111111111",
      idempotencyKey: "test-idempotency-key-1",
      inspectFirst: true,
      fetchFn: mockFetch as any,
    });

    expect(res.inspected).toBe(true);
    expect(res.runId).toBe(runId);
    expect(res.terminalStatus).toBe("COMPLETED");
    expect(res.report?.verdict).toBe("PASS");
    expect(res.receipt?.canonicalization).toBe("JCS-RFC8785");
  });

  it("should materialize case-specific passing fixture", () => {
    const tmpDir = join(__dirname, "..", "tmp-test-fixture-pass");
    harness.materializeFixture("prvc.synthetic.node.core-pass-001", "default", tmpDir);

    expect(existsSync(join(tmpDir, "package.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(pkg.scripts.test).toContain("process.exit(0)");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should materialize case-specific failing fixture for core-fail-test-003", () => {
    const tmpDir = join(__dirname, "..", "tmp-test-fixture-fail");
    harness.materializeFixture("prvc.synthetic.node.core-fail-test-003", "default", tmpDir);

    expect(existsSync(join(tmpDir, "package.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(pkg.scripts.test).toContain("process.exit(1)");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should materialize empty directory for core-empty-repo-010", () => {
    const tmpDir = join(__dirname, "..", "tmp-test-fixture-empty");
    harness.materializeFixture("prvc.synthetic.node.core-empty-repo-010", "default", tmpDir);

    expect(existsSync(tmpDir)).toBe(true);
    expect(existsSync(join(tmpDir, "package.json"))).toBe(false);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refuses to fabricate fixtures for imported candidate cases", () => {
    const tmpDir = join(__dirname, "..", "tmp-test-fixture-imported-candidate");

    expect(() =>
      harness.materializeFixture("prvc.real.pbv.javascript.express-037", "buggy", tmpDir),
    ).toThrow(/require source provenance and a reproducible recipe/);
    expect(existsSync(tmpDir)).toBe(false);
  });

  it("rejects typoed case identifiers instead of suffix-matching a fixture", () => {
    const tmpDir = join(__dirname, "..", "tmp-test-fixture-typo");
    expect(() =>
      harness.materializeFixture("prvc.synthetic.node.javascript.core-empty-repo-010", "default", tmpDir),
    ).toThrow(/Unknown PRVC case\/variant/);
    expect(existsSync(tmpDir)).toBe(false);
  });

  it("refuses sandbox materialization without a target-runner adapter", () => {
    const tmpDir = join(__dirname, "..", "tmp-test-fixture-sandbox");
    expect(() =>
      harness.materializeFixture("prvc.synthetic.sandbox.node.resource-memory-cgroup-v1", "default", tmpDir),
    ).toThrow(/require a target-runner adapter and live execution evidence/);
    expect(existsSync(tmpDir)).toBe(false);
  });

  it("should verify sandbox teardown with no residual files", () => {
    const teardown = harness.verifySandboxTeardown(join(__dirname, ".."), "non-existent-run-id");
    expect(teardown.clean).toBe(true);
  });
});
