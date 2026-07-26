/* eslint-disable @typescript-eslint/no-explicit-any -- PRVC candidate records are schema-validated JSON. */
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import jsyaml from "js-yaml";
import { hashCanonicalJson } from "./jcs.js";
import type { PrvcCase, PrvcOracle, RunStatus, Verdict } from "./types.js";

const VALID_OCI_DIGEST = "node:22-alpine@sha256:e13460e6e73f8a49c933c0e159045b85a374826b1b590e88383f98018d45be31";
// RFC 8032 test-vector seed. This signs generated fixture integrity only; it is
// not an external certification or a private production signing key.
const RELEASE_FIXTURE_PRIVATE_KEY_DER = "302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";

export function generateAllCases(baseDir: string) {
  const casesDir = join(baseDir, "cases");
  const indexDir = join(baseDir, "index");
  const manifestsDir = join(baseDir, "manifests");
  const signaturesDir = join(manifestsDir, "signatures");
  const quarantineDir = join(baseDir, "quarantine");
  const adaptersDir = join(baseDir, "adapters");
  const generatorsDir = join(baseDir, "generators");

  // Create required directories
  mkdirSync(casesDir, { recursive: true });
  mkdirSync(indexDir, { recursive: true });
  mkdirSync(manifestsDir, { recursive: true });
  mkdirSync(signaturesDir, { recursive: true });
  mkdirSync(quarantineDir, { recursive: true });
  mkdirSync(adaptersDir, { recursive: true });
  mkdirSync(generatorsDir, { recursive: true });

  // Clean stale rejection report or stale quarantine fixtures if present
  const staleRejectionReport = join(quarantineDir, "rejection-report.json");
  if (existsSync(staleRejectionReport)) {
    rmSync(staleRejectionReport, { force: true });
  }
  for (const staleFixture of ["flaky-race-001.json", "flaky-race-010.json"]) {
    const path = join(quarantineDir, staleFixture);
    if (existsSync(path)) rmSync(path, { force: true });
  }

  // Create adapters placeholder files
  writeFileSync(
    join(adaptersDir, "README.md"),
    "# PRVC Benchmark Adapters\n\nContains templates for source import adapters. Source revisions and run evidence are required before imported records are certified.\n",
    "utf8"
  );
  writeFileSync(
    join(generatorsDir, "README.md"),
    "# PRVC Synthetic Generators\n\nContains generator templates for core, sandbox, and protocol test vectors.\n",
    "utf8"
  );

  const caseDefinitions: Array<{ caseObj: PrvcCase; oracleObj: PrvcOracle }> = [];

  // Helper to build case and oracle
  function addCase(
    id: string,
    title: string,
    category: "synthetic" | "real-jsts" | "sandbox" | "protocol",
    kind: "synthetic" | "swe-polybench-verified" | "bugsjs",
    lang: "javascript" | "typescript",
    pm: "npm" | "pnpm",
    profile: string,
    variantsDef: Record<
      string,
      {
        status: RunStatus;
        verdict: Verdict;
        reason: string;
        failingTest?: string;
      }
    >
  ) {
    const variantsCase: PrvcCase["variants"] = {};
    const variantsOracle: PrvcOracle["variants"] = {};

    for (const [vName, vData] of Object.entries(variantsDef)) {
      variantsCase[vName] = {
        request: {
          verification_skill: {
            name: "node-typescript",
            version: "1.0.0",
            digest: "sha256:e13460e6e73f8a49c933c0e159045b85a374826b1b590e88383f98018d45be31",
          },
        },
      };

      const expectedObj: PrvcOracle["variants"][string]["expected"] = {
        terminal_status: vData.status,
        verdict: vData.verdict,
        reason_code: vData.reason,
      };

      if (vData.failingTest) {
        expectedObj.tests = { failing_exact: [vData.failingTest] };
      }

      variantsOracle[vName] = { expected: expectedObj };
    }

    const rawCase: Omit<PrvcCase, "integrity"> = {
      schema_version: "prvc.case/v1",
      case_id: id,
      title,
      description: `PRVC validation case ${id}`,
      suite: ["smoke", category],
      visibility: "public",
      source: {
        kind: kind === "synthetic" ? "synthetic" : "imported-unverified",
      },
      licenses: {
        dataset: { expression: kind === "synthetic" ? "generated fixture" : "unverified" },
      },
      subject: {
        language: lang,
        project_type: "node",
        package_manager: pm,
      },
      execution_profile: {
        profile_id: profile,
        runtime: {
          image: VALID_OCI_DIGEST,
          architecture: "linux/amd64",
        },
        limits: {
          wall_time_seconds: 120,
          cpu_time_seconds: 90,
          memory_bytes: 2147483648,
          pids: 128,
        },
      },
      variants: variantsCase,
      oracle_ref: "oracle.yaml",
    };

    const hash = hashCanonicalJson(rawCase);
    const caseObj: PrvcCase = {
      ...rawCase,
      integrity: {
        case_hash_algorithm: "sha256",
        case_hash_canonicalization: "RFC8785",
        sha256: hash,
      },
    };

    const oracleObj: PrvcOracle = {
      schema_version: "prvc.oracle/v1",
      case_id: id,
      variants: variantsOracle,
    };

    if (Object.keys(variantsDef).includes("buggy") && Object.keys(variantsDef).includes("fixed")) {
      oracleObj.relations = [{ type: "fail-to-pass", from: "buggy", to: "fixed" }];
    }

    caseDefinitions.push({ caseObj, oracleObj });
  }

  // 1-10 Core cases
  addCase("prvc.synthetic.node.core-pass-001", "Core PASS execution", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.core-pass-pnpm-002", "Core PASS execution pnpm", "synthetic", "synthetic", "typescript", "pnpm", "node-pnpm/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.core-fail-test-003", "Core FAIL test failure", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "test/auth.test.js::Auth::rejects invalid token" } });
  addCase("prvc.synthetic.node.core-fail-build-004", "Core FAIL build failure", "synthetic", "synthetic", "typescript", "pnpm", "node-typescript/v1", { default: { status: "COMPLETED", verdict: "FAIL", reason: "BUILD_FAILED" } });
  addCase("prvc.synthetic.node.core-fail-typecheck-005", "Core FAIL typecheck failure", "synthetic", "synthetic", "typescript", "pnpm", "node-typescript/v1", { default: { status: "COMPLETED", verdict: "FAIL", reason: "TYPECHECK_FAILED" } });
  addCase("prvc.synthetic.node.core-fail-lockfile-006", "Core FAIL invalid lockfile", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "FAIL", reason: "LOCKFILE_INVALID" } });
  addCase("prvc.synthetic.node.core-no-tests-req-007", "Core FAIL missing required tests", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "FAIL", reason: "NO_TESTS_DISCOVERED" } });
  addCase("prvc.synthetic.node.core-no-tests-opt-008", "Core PASS optional tests absent", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.core-missing-script-009", "Core INCONCLUSIVE missing script", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "REJECTED", verdict: "INCONCLUSIVE", reason: "MISSING_PROJECT_MANIFEST" } });
  addCase("prvc.synthetic.node.core-empty-repo-010", "Core INCONCLUSIVE empty repo", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "REJECTED", verdict: "INCONCLUSIVE", reason: "MISSING_PROJECT_MANIFEST" } });

  // 11-16 Detection & Input cases
  addCase("prvc.synthetic.node.detect-npm-lock-011", "Detect npm lockfile", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.detect-pnpm-lock-012", "Detect pnpm lockfile", "synthetic", "synthetic", "typescript", "pnpm", "node-pnpm/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.detect-typescript-013", "Detect typescript config", "synthetic", "synthetic", "typescript", "pnpm", "node-typescript/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.detect-workspace-014", "Detect pnpm workspace", "synthetic", "synthetic", "typescript", "pnpm", "node-pnpm-workspace/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.detect-conflicting-locks-015", "Detect conflicting lockfiles", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "REJECTED", verdict: "INCONCLUSIVE", reason: "CONFLICTING_LOCKFILES" } });
  addCase("prvc.synthetic.node.detect-missing-manifest-016", "Detect missing manifest", "synthetic", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "REJECTED", verdict: "INCONCLUSIVE", reason: "MISSING_PROJECT_MANIFEST" } });

  // 17-24 Sandbox & Resources cases
  addCase("prvc.synthetic.node.sandbox-secret-env-017", "Sandbox canary env isolation", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "SANDBOX_FAILURE" } });
  addCase("prvc.synthetic.node.sandbox-host-file-018", "Sandbox canary host file isolation", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "SANDBOX_FAILURE" } });
  addCase("prvc.synthetic.node.sandbox-docker-socket-019", "Sandbox canary docker socket isolation", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "SANDBOX_FAILURE" } });
  addCase("prvc.synthetic.node.sandbox-write-outside-020", "Sandbox canary write outside workspace blocked", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "FILESYSTEM_POLICY_BLOCK" } });
  addCase("prvc.synthetic.node.sandbox-network-egress-021", "Sandbox canary egress network blocked", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "NETWORK_POLICY_BLOCK" } });
  addCase("prvc.synthetic.node.resource-timeout-022", "Resource wall time timeout", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "TIMEOUT", verdict: "INCONCLUSIVE", reason: "TIMEOUT" } });
  addCase("prvc.synthetic.node.resource-memory-limit-023", "Resource memory limit exceeded", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "RESOURCE_EXHAUSTED", verdict: "INCONCLUSIVE", reason: "MEMORY_LIMIT" } });
  addCase("prvc.synthetic.node.resource-log-limit-024", "Resource log flood limit exceeded", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "RESOURCE_EXHAUSTED", verdict: "INCONCLUSIVE", reason: "LOG_LIMIT" } });

  // 25-36 Receipt & Protocol cases (12 vectors)
  addCase("prvc.synthetic.node.receipt-valid-025", "Valid signed receipt", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.receipt-tamper-commit-026", "Tampered receipt commit SHA", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_SUBJECT_MISMATCH" } });
  addCase("prvc.synthetic.node.receipt-tamper-skill-027", "Tampered receipt skill digest", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_HASH_MISMATCH" } });
  addCase("prvc.synthetic.node.receipt-tamper-verdict-028", "Tampered receipt verdict field", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_HASH_MISMATCH" } });
  addCase("prvc.synthetic.node.receipt-tamper-sig-029", "Truncated receipt signature", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_SIGNATURE_INVALID" } });
  addCase("prvc.synthetic.node.receipt-canonicalization-030", "RFC 8785 canonical JSON vector", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "PASS", reason: "NONE" } });
  addCase("prvc.synthetic.node.receipt-tamper-timestamp-031", "Tampered receipt timestamp", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_SIGNATURE_INVALID" } });
  addCase("prvc.synthetic.node.receipt-tamper-runid-032", "Tampered receipt run ID", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_HASH_MISMATCH" } });
  addCase("prvc.synthetic.node.receipt-tamper-check-033", "Removed failed check from receipt", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_HASH_MISMATCH" } });
  addCase("prvc.synthetic.node.receipt-tamper-keyid-034", "Unknown receipt key ID", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_SIGNER_UNKNOWN" } });
  addCase("prvc.synthetic.node.receipt-tamper-alg-035", "Unsupported receipt hash algorithm", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_SCHEMA_INVALID" } });
  addCase("prvc.synthetic.node.receipt-tamper-version-036", "Unsupported receipt contract version", "protocol", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "COMPLETED", verdict: "INCONCLUSIVE", reason: "RECEIPT_SCHEMA_INVALID" } });

  // 37-41 Imported JS/TS candidate descriptions; source evidence is pending.
  addCase("prvc.real.pbv.javascript.express-037", "Imported JavaScript candidate 037 (source evidence pending)", "real-jsts", "swe-polybench-verified", "javascript", "npm", "node-npm/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "test/res.send.js::res.send::handles buffers correctly" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  addCase("prvc.real.pbv.typescript.prettier-038", "Imported TypeScript candidate 038 (source evidence pending)", "real-jsts", "swe-polybench-verified", "typescript", "pnpm", "node-typescript/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "tests/format.test.ts::Prettier::formats satisfies operator" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  addCase("prvc.real.pbv.typescript.eslint-039", "Imported TypeScript candidate 039 (source evidence pending)", "real-jsts", "swe-polybench-verified", "typescript", "pnpm", "node-typescript/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "tests/rules/no-explicit-any.test.ts::rule::reports explicit any" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  addCase("prvc.real.bugsjs.javascript.eslint-040", "Imported JavaScript candidate 040 (source evidence pending)", "real-jsts", "bugsjs", "javascript", "npm", "node-npm/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "tests/lib/rules/semi.js::semi rule::fails on missing semicolon" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  addCase("prvc.real.bugsjs.javascript.express-041", "Imported JavaScript candidate 041 (source evidence pending)", "real-jsts", "bugsjs", "javascript", "npm", "node-npm/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "test/router.js::Router::parses optional params" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  // 42-46 Expanded Sandbox & Resource Canaries
  addCase("prvc.synthetic.sandbox.node.oom-canary-042", "Sandbox canary Buffer OOM allocation", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "RESOURCE_EXHAUSTED", verdict: "INCONCLUSIVE", reason: "MEMORY_LIMIT" } });
  addCase("prvc.synthetic.sandbox.node.pid-fork-canary-043", "Sandbox canary PID fork bomb limit", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "RESOURCE_EXHAUSTED", verdict: "INCONCLUSIVE", reason: "PID_LIMIT" } });
  addCase("prvc.synthetic.sandbox.node.symlink-escape-044", "Sandbox canary symlink escape blocked", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "FILESYSTEM_POLICY_BLOCK" } });
  addCase("prvc.synthetic.sandbox.node.unhandled-signal-045", "Sandbox canary unhandled SIGSEGV handling", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "RESOURCE_EXHAUSTED", verdict: "INCONCLUSIVE", reason: "SANDBOX_FAILURE" } });
  addCase("prvc.synthetic.sandbox.node.egress-leak-046", "Sandbox canary egress network socket blocked", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "NETWORK_POLICY_BLOCK" } });

  // 47-50 Imported JS/TS candidate descriptions; source evidence is pending.
  addCase("prvc.real.pbv.javascript.mocha-047", "Imported JavaScript candidate 047 (source evidence pending)", "real-jsts", "swe-polybench-verified", "javascript", "npm", "node-npm/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "test/runner.test.js::Runner::handles async timeouts" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  addCase("prvc.real.pbv.typescript.jest-048", "Imported TypeScript candidate 048 (source evidence pending)", "real-jsts", "swe-polybench-verified", "typescript", "pnpm", "node-typescript/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "tests/mock.test.ts::Mock::restores original implementation" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  addCase("prvc.real.bugsjs.javascript.bower-049", "Imported JavaScript candidate 049 (source evidence pending)", "real-jsts", "bugsjs", "javascript", "npm", "node-npm/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "test/resolver.js::Resolver::parses semver tags" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  addCase("prvc.real.bugsjs.javascript.hexo-050", "Imported JavaScript candidate 050 (source evidence pending)", "real-jsts", "bugsjs", "javascript", "npm", "node-npm/v1", {
    buggy: { status: "COMPLETED", verdict: "FAIL", reason: "TEST_FAILURE", failingTest: "test/post.js::Post::parses front-matter YAML" },
    fixed: { status: "COMPLETED", verdict: "PASS", reason: "NONE" },
  });

  // 51-56 New Research Synthetic Sandbox Expansion (from synthetic-sandbox-expansion.yaml)
  addCase("prvc.synthetic.sandbox.node.sandbox-symlink-escape-v1", "Symlink traversal cannot read a host/workspace-external canary", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "FILESYSTEM_POLICY_BLOCK" } });
  addCase("prvc.synthetic.sandbox.node.resource-memory-cgroup-v1", "Bounded Buffer allocation is stopped by cgroups v2 memory limit", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "RESOURCE_EXHAUSTED", verdict: "INCONCLUSIVE", reason: "MEMORY_LIMIT" } });
  addCase("prvc.synthetic.sandbox.node.resource-pids-cgroup-v1", "Bounded child-process burst is stopped by pids.max", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "RESOURCE_EXHAUSTED", verdict: "INCONCLUSIVE", reason: "PID_LIMIT" } });
  addCase("prvc.synthetic.sandbox.node.process-signal-cleanup-v1", "Supervisor termination and cleanup on SIGTERM then SIGKILL escalation", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "CANCELLED", verdict: "INCONCLUSIVE", reason: "CANCELLED" } });
  addCase("prvc.synthetic.sandbox.node.sandbox-kernel-surfaces-v1", "No privileged eBPF, Docker API, host proc, or writable sys access", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "SANDBOX_FAILURE" } });
  addCase("prvc.synthetic.sandbox.node.sandbox-egress-controlled-v1", "Verification phase cannot contact controlled egress sink", "sandbox", "synthetic", "javascript", "npm", "node-npm/v1", { default: { status: "POLICY_BLOCKED", verdict: "INCONCLUSIVE", reason: "NETWORK_POLICY_BLOCK" } });

  // Clean stale case directories that are no longer defined
  const validCaseIds = new Set(caseDefinitions.map((c) => c.caseObj.case_id));
  if (existsSync(casesDir)) {
    const existingDirs = readdirSync(casesDir);
    for (const d of existingDirs) {
      if (!validCaseIds.has(d)) {
        rmSync(join(casesDir, d), { recursive: true, force: true });
      }
    }
  }

  // Write case directories and files using js-yaml dump
  const casesJsonlLines: string[] = [];
  const variantsJsonlLines: string[] = [];
  const checksumLines: string[] = [];

  for (const { caseObj, oracleObj } of caseDefinitions) {
    const cDir = join(casesDir, caseObj.case_id);
    mkdirSync(cDir, { recursive: true });

    const caseYamlStr = jsyaml.dump(caseObj, { sortKeys: true });
    const oracleYamlStr = jsyaml.dump(oracleObj, { sortKeys: true });

    writeFileSync(join(cDir, "case.yaml"), caseYamlStr, "utf8");
    writeFileSync(join(cDir, "oracle.yaml"), oracleYamlStr, "utf8");
    writeFileSync(join(cDir, "README.md"), `# Case ${caseObj.case_id}\n\n${caseObj.title}\n`, "utf8");

    casesJsonlLines.push(JSON.stringify(caseObj));

    for (const [vName, vObj] of Object.entries(caseObj.variants)) {
      const vRecord = {
        case_id: caseObj.case_id,
        variant: vName,
        git_ref: vObj.request.git_ref ?? null,
        expected_verdict: oracleObj.variants[vName]?.expected.verdict,
        expected_status: oracleObj.variants[vName]?.expected.terminal_status,
      };
      variantsJsonlLines.push(JSON.stringify(vRecord));
    }

    const cHash = createHash("sha256").update(caseYamlStr).digest("hex");
    checksumLines.push(`${cHash}  cases/${caseObj.case_id}/case.yaml`);
  }

  writeFileSync(join(indexDir, "cases.jsonl"), casesJsonlLines.join("\n") + "\n", "utf8");
  writeFileSync(join(indexDir, "variants.jsonl"), variantsJsonlLines.join("\n") + "\n", "utf8");

  // Helper to build a valid candidate record matching candidate-record.schema.json
  function makeCandidateRecord(caseObj: PrvcCase, oracleObj: PrvcOracle) {
    const candSlug = caseObj.case_id.replace(/^prvc\./, "");
    const candId = `candidate.${candSlug}`;

    const variantsCandidate: Record<string, any> = {};
    for (const vName of Object.keys(caseObj.variants)) {
      variantsCandidate[vName] = {
        patches: [],
      };
    }

    const firstVarName = Object.keys(oracleObj.variants)[0] || "default";
    const buggyVarName = oracleObj.variants["buggy"] ? "buggy" : firstVarName;
    const failingTests = oracleObj.variants[buggyVarName]?.expected.tests?.failing_exact || ["test failure"];

    return {
      schema_version: "prvc.candidate/v2",
      candidate_id: candId,
      proposed_case_id: caseObj.case_id,
      title: caseObj.title,
      source: {
        kind: caseObj.source.kind,
      },
      subject: {
        language: caseObj.subject.language,
        runtime_family: "node",
        package_manager: caseObj.subject.package_manager,
        project_layout: "single-package",
      },
      materialization: {
        mode: "recipe-only",
        architecture: "linux/amd64",
        container_image_digest: VALID_OCI_DIGEST,
        network_policy: "disabled",
      },
      variants: {
        buggy: variantsCandidate["buggy"] || variantsCandidate["default"],
        fixed: variantsCandidate["fixed"] || variantsCandidate["default"],
      },
      oracle: {
        buggy_verdict: oracleObj.variants[buggyVarName]?.expected.verdict === "PASS" ? "FAIL" : oracleObj.variants[buggyVarName]?.expected.verdict,
        fixed_verdict: "PASS",
        failing_tests_exact: failingTests,
      },
      reproducibility: {
        level: "CANDIDATE",
        buggy_runs: { attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        fixed_runs: { attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        hosts: [],
      },
      licenses: { dataset: "unverified", upstream: "unverified", redistribution: "metadata-only" },
      decision: {
        status: "pending",
        reason_codes: ["SOURCE_EVIDENCE_PENDING", "RUN_EVIDENCE_PENDING"],
      },
    };
  }

  // Generate 56 candidate records matching all 56 cases 1:1!
  const candidateRecords = caseDefinitions.map(({ caseObj, oracleObj }) =>
    makeCandidateRecord(caseObj, oracleObj)
  );

  writeFileSync(join(indexDir, "candidates.jsonl"), candidateRecords.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");

  writeFileSync(
    join(indexDir, "sources.lock.json"),
    JSON.stringify(
      {
        schema_version: "prvc.source-lock/v1",
        source_kind: "generated-prvc-fixtures",
        artifact_sha256: createHash("sha256").update(casesJsonlLines.join("\n")).digest("hex"),
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    join(indexDir, "licenses.jsonl"),
    JSON.stringify({ dataset: "unverified", upstream: "unverified" }) + "\n",
    "utf8"
  );

  // Write certification report conforming strictly to certification.schema.json (prvc.certification/v1)
  const certificationReport = {
    schema_version: "prvc.certification/v1",
    level: "IMPORTED",
    summary: {
      total_cases: caseDefinitions.length,
      passed_cases: 0,
      failed_cases: 0,
    },
  };
  writeFileSync(join(manifestsDir, "certification-report.json"), JSON.stringify(certificationReport, null, 2), "utf8");

  // Pending candidates have no external source or execution evidence yet.
  const selectionReport = {
    schema_version: "prvc.selection-report/v1",
    candidates: candidateRecords.length,
    reproduced: 0,
    gold: 0,
    quarantined: 0,
    reasons: {},
  };
  writeFileSync(join(quarantineDir, "selection-report.json"), JSON.stringify(selectionReport, null, 2), "utf8");

  const manifestData = {
    schema_version: "prvc.release/v1",
    prvc_version: "0.1.0",
    suite: "smoke",
    total_cases: caseDefinitions.length,
    total_variants: variantsJsonlLines.length,
    level: "IMPORTED",
    fixture_signature: {
      algorithm: "Ed25519",
      key_material: "RFC8032 test vector",
      purpose: "reproducible fixture integrity only",
      publisher_authenticity: false,
      notice: "Anyone can recreate and re-sign this fixture; do not trust this key as publisher identity.",
    },
  };

  const manifestJsonStr = JSON.stringify(manifestData, null, 2);
  writeFileSync(join(manifestsDir, "release-manifest.json"), manifestJsonStr, "utf8");

  const privateKey = createPrivateKey({
    key: Buffer.from(RELEASE_FIXTURE_PRIVATE_KEY_DER, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const signatureHex = sign(null, Buffer.from(manifestJsonStr), privateKey).toString("hex");
  const pubKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  writeFileSync(join(signaturesDir, "release-manifest.sig"), signatureHex, "utf8");
  writeFileSync(join(signaturesDir, "release-key.pub"), pubKeyPem, "utf8");

  generateSha256Sums(baseDir);

  writeFileSync(
    join(quarantineDir, "README.md"),
    "# PRVC Quarantine Directory\n\nNo quarantine observations are recorded without run evidence.\n",
    "utf8"
  );

  return { totalCases: caseDefinitions.length, totalVariants: variantsJsonlLines.length };
}

export function generateSha256Sums(baseDir: string): void {
  const manifestsDir = join(baseDir, "manifests");
  const checksumLines: string[] = [];

  const casesDir = join(baseDir, "cases");
  if (existsSync(casesDir)) {
    const cases = readdirSync(casesDir).sort();
    for (const cId of cases) {
      const cDir = join(casesDir, cId);
      const files = (readdirSync(cDir, { recursive: true }) as string[]).sort();
      for (const f of files) {
        const fullP = join(cDir, f);
        if (existsSync(fullP)) {
          try {
            const content = readFileSync(fullP);
            const h = createHash("sha256").update(content).digest("hex");
            checksumLines.push(`${h}  cases/${cId}/${f}`);
          } catch {
            // skip directories
          }
        }
      }
    }
  }

  for (const dirName of ["schemas", "vocabulary", "suites", "profiles", "index", "manifests", "quarantine"]) {
    const dPath = join(baseDir, dirName);
    if (existsSync(dPath)) {
      const files = (readdirSync(dPath, { recursive: true }) as string[]).sort();
      for (const f of files) {
        if (f.includes("SHA256SUMS") || f.startsWith("signatures")) continue;
        const fullP = join(dPath, f);
        if (existsSync(fullP)) {
          try {
            const content = readFileSync(fullP);
            const h = createHash("sha256").update(content).digest("hex");
            checksumLines.push(`${h}  ${dirName}/${f}`);
          } catch {
            // skip directories
          }
        }
      }
    }
  }

  writeFileSync(join(manifestsDir, "SHA256SUMS"), checksumLines.join("\n") + "\n", "utf8");
}

