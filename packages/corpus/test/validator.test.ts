/* eslint-disable @typescript-eslint/no-explicit-any -- invalid schema fixtures intentionally escape compile-time vocabulary types. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVIDENCE_REQUIRED_REPRODUCIBILITY_LEVELS,
  PrvcValidator,
  REPRODUCIBILITY_LEVELS,
} from "../src/validator.js";
import { hashCanonicalJson } from "../src/jcs.js";
import type { PrvcCase, PrvcOracle } from "../src/types.js";

describe("PRVC Validator with Ajv JSON Schema Engine", () => {
  const prvcDir = join(__dirname, "..");
  const validator = new PrvcValidator(prvcDir);

  it("should validate a compliant PRVC case object with matching JCS RFC 8785 hash", () => {
    const rawCase = {
      schema_version: "prvc.case/v1" as const,
      case_id: "prvc.synthetic.node.core-pass-001",
      title: "Core PASS execution",
      suite: ["smoke", "synthetic"],
      visibility: "public" as const,
      source: { kind: "synthetic" as const },
      licenses: { dataset: { expression: "MIT" } },
      subject: { language: "javascript" as const, project_type: "node" as const, package_manager: "npm" as const },
      execution_profile: { profile_id: "node-npm/v1" },
      variants: {
        default: {
          request: { git_ref: "1111111111111111111111111111111111111111" },
        },
      },
      oracle_ref: "oracle.yaml",
    };

    const calculatedHash = hashCanonicalJson(rawCase);
    const caseObj: PrvcCase = {
      ...rawCase,
      integrity: {
        case_hash_algorithm: "sha256",
        case_hash_canonicalization: "RFC8785",
        sha256: calculatedHash,
      },
    };

    const res = validator.validateCase(caseObj);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("should reject a case object with tampered payload and invalid JCS hash", () => {
    const caseObj: PrvcCase = {
      schema_version: "prvc.case/v1",
      case_id: "prvc.synthetic.node.core-pass-001",
      title: "Tampered title",
      suite: ["smoke", "synthetic"],
      visibility: "public",
      source: { kind: "synthetic" },
      licenses: { dataset: { expression: "MIT" } },
      subject: { language: "javascript", project_type: "node", package_manager: "npm" },
      execution_profile: { profile_id: "node-npm/v1" },
      variants: {
        default: {
          request: { git_ref: "1111111111111111111111111111111111111111" },
        },
      },
      oracle_ref: "oracle.yaml",
      integrity: {
        case_hash_algorithm: "sha256",
        case_hash_canonicalization: "RFC8785",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    };

    const res = validator.validateCase(caseObj);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("CASE_HASH_MISMATCH"))).toBe(true);
  });

  it("should validate a compliant PRVC oracle object and vocabulary values", () => {
    const oracleObj: PrvcOracle = {
      schema_version: "prvc.oracle/v1",
      case_id: "prvc.synthetic.node.core-pass-001",
      variants: {
        default: {
          expected: {
            terminal_status: "COMPLETED",
            verdict: "PASS",
            reason_code: "NONE",
          },
        },
      },
    };

    const res = validator.validateOracle(oracleObj);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("should reject an oracle object with invalid terminal status or reason code", () => {
    const oracleObj: PrvcOracle = {
      schema_version: "prvc.oracle/v1",
      case_id: "prvc.synthetic.node.invalid-001",
      variants: {
        default: {
          expected: {
            terminal_status: "UNKNOWN_STATUS" as any,
            verdict: "PASS",
            reason_code: "UNKNOWN_REASON",
          },
        },
      },
    };

    const res = validator.validateOracle(oracleObj);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("should validate valid certification report, candidate record, and quarantine record schemas", () => {
    const certRes = validator.validateCertification({
      schema_version: "prvc.certification/v1",
      level: "IMPORTED",
      summary: { total_cases: 50, passed_cases: 0, failed_cases: 0 },
    });
    expect(certRes.valid).toBe(true);

    const candRes = validator.validateCandidate({
      schema_version: "prvc.candidate/v2",
      candidate_id: "candidate.imported.javascript.001",
      proposed_case_id: "prvc.real.pbv.javascript.imported-001",
      title: "Imported JavaScript candidate (source evidence pending)",
      source: {
        kind: "imported-unverified",
      },
      subject: {
        language: "javascript",
        runtime_family: "node",
        package_manager: "npm",
        project_layout: "single-package",
      },
      materialization: {
        mode: "recipe-only",
        architecture: "linux/amd64",
        container_image_digest: "node:22-alpine@sha256:e13460e6e73f8a49c933c0e159045b85a374826b1b590e88383f98018d45be31",
        network_policy: "disabled",
      },
      variants: {
        buggy: {
          patches: [],
        },
        fixed: {
          patches: [],
        },
      },
      oracle: {
        buggy_verdict: "FAIL",
        fixed_verdict: "PASS",
        failing_tests_exact: ["test/res.send.js::res.send::handles buffers correctly"],
      },
      reproducibility: {
        level: "CANDIDATE",
        buggy_runs: { attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        fixed_runs: { attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        hosts: [],
      },
      licenses: { dataset: "unverified", upstream: "unverified", redistribution: "metadata-only" },
      decision: { status: "pending", reason_codes: ["SOURCE_EVIDENCE_PENDING", "RUN_EVIDENCE_PENDING"] },
    });
    expect(candRes.valid).toBe(true);

    const quarRes = validator.validateQuarantine({
      schema_version: "prvc.quarantine/v2",
      candidate_id: "candidate.synthetic.schema-fixture-010",
      source_kind: "synthetic",
      stage: "SCHEMA",
      reason_code: "SCHEMA_INCOMPATIBLE",
      summary: "Schema fixture",
      observed_at: "2026-07-24T00:00:00Z",
    });
    expect(quarRes.valid).toBe(true);
  });

  it("should reject unsupported certification claims on an imported-unverified candidate", () => {
    const result = validator.validateCandidate({
      schema_version: "prvc.candidate/v2",
      candidate_id: "candidate.imported.unsupported-claims",
      proposed_case_id: "prvc.real.imported.unsupported-claims",
      title: "Imported candidate",
      source: {
        kind: "imported-unverified",
        dataset_repository_url: "https://example.invalid/unverified",
      },
      subject: { language: "javascript", runtime_family: "node", package_manager: "npm", project_layout: "single-package" },
      materialization: { mode: "recipe-only", architecture: "linux/amd64", container_image_digest: "node:22-alpine@sha256:e13460e6e73f8a49c933c0e159045b85a374826b1b590e88383f98018d45be31", network_policy: "disabled" },
      variants: { buggy: { patches: [] }, fixed: { patches: [] } },
      oracle: { buggy_verdict: "FAIL", fixed_verdict: "PASS", failing_tests_exact: ["unverified"] },
      reproducibility: {
        level: "REPRODUCED",
        buggy_runs: { attempts: 1, expected_outcomes: 1, unexpected_outcomes: 0, pass_rate: 1 },
        fixed_runs: { attempts: 1, expected_outcomes: 1, unexpected_outcomes: 0, pass_rate: 1 },
        hosts: ["unsupported-host"],
      },
      licenses: { dataset: "unverified", upstream: "unverified", redistribution: "metadata-only" },
      decision: { status: "accepted", reason_codes: ["VERIFIED_DELETION"] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Imported-unverified candidate must not claim source evidence: dataset_repository_url");
    expect(result.errors).toContain("Imported-unverified candidate must use reproducibility level CANDIDATE");
    expect(result.errors).toContain("Imported-unverified candidate must not claim execution hosts");
    expect(result.errors).toContain("Imported-unverified candidate decision must remain pending");
  });

  it("should fail closed for external provenance, run evidence, and source-lock hashes", () => {
    const externalWithoutProvenance = {
      schema_version: "prvc.candidate/v2",
      candidate_id: "candidate.external.without-provenance",
      proposed_case_id: "prvc.real.external.without-provenance",
      title: "External candidate",
      source: { kind: "bugsjs" },
      subject: { language: "javascript", runtime_family: "node", package_manager: "npm", project_layout: "single-package" },
      materialization: { mode: "recipe-only", architecture: "linux/amd64", container_image_digest: "node:22-alpine@sha256:e13460e6e73f8a49c933c0e159045b85a374826b1b590e88383f98018d45be31", network_policy: "disabled" },
      variants: { buggy: { patches: [] }, fixed: { patches: [] } },
      oracle: { buggy_verdict: "FAIL", fixed_verdict: "PASS", failing_tests_exact: ["external"] },
      reproducibility: {
        level: "CANDIDATE",
        buggy_runs: { attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        fixed_runs: { attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        hosts: [],
      },
      licenses: { dataset: "unknown", upstream: "unknown", redistribution: "metadata-only" },
      decision: { status: "pending", reason_codes: ["SOURCE_EVIDENCE_PENDING"] },
    };
    expect(validator.validateCandidate(externalWithoutProvenance).valid).toBe(false);

    const externalWithMalformedRevision = {
      ...externalWithoutProvenance,
      source: {
        kind: "bugsjs",
        dataset_repository_url: "https://example.invalid/dataset",
        dataset_revision_sha: "not-a-sha",
        upstream_instance_id: "case-1",
        upstream_repository_url: "https://example.invalid/upstream",
      },
    };
    expect(validator.validateCandidate(externalWithMalformedRevision).valid).toBe(false);

    const reproducedWithoutEvidence = {
      ...externalWithMalformedRevision,
      source: { ...externalWithMalformedRevision.source, dataset_revision_sha: "a".repeat(40) },
      reproducibility: {
        level: "REPRODUCED",
        buggy_runs: { attempts: 1, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        fixed_runs: { attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 },
        hosts: [],
      },
      decision: { status: "accepted", reason_codes: ["VERIFIED_DELETION"] },
    };
    const reproducedResult = validator.validateCandidate(reproducedWithoutEvidence);
    expect(reproducedResult.valid).toBe(false);
    expect(reproducedResult.errors).toContain("Evidence-bearing candidate requires consistent nonzero buggy_runs");
    expect(reproducedResult.errors).toContain("Evidence-bearing candidate requires consistent nonzero fixed_runs");
    expect(reproducedResult.errors).toContain("Evidence-bearing candidate requires at least one execution host");
    expect(reproducedResult.errors).toContain("Evidence-bearing candidate requires a run evidence_path");

    for (const level of ["STABLE", "PORTABLE"]) {
      const result = validator.validateCandidate({
        ...reproducedWithoutEvidence,
        reproducibility: { ...reproducedWithoutEvidence.reproducibility, level },
        decision: { status: "pending", reason_codes: ["RUN_EVIDENCE_PENDING"] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Evidence-bearing candidate requires consistent nonzero buggy_runs");
      expect(result.errors).toContain("Evidence-bearing candidate requires at least one execution host");
      expect(result.errors).toContain("Evidence-bearing candidate requires a run evidence_path");
    }

    const schema = JSON.parse(readFileSync(join(prvcDir, "schemas", "candidate-record.schema.json"), "utf8"));
    const schemaLevels = schema.properties.reproducibility.properties.level.enum;
    expect(schemaLevels).toEqual(REPRODUCIBILITY_LEVELS);
    expect([...EVIDENCE_REQUIRED_REPRODUCIBILITY_LEVELS].sort()).toEqual(
      schemaLevels.filter((level: string) => level !== "CANDIDATE" && level !== "QUARANTINED").sort()
    );

    expect(validator.validateSourceLock({
      schema_version: "prvc.source-lock/v1",
      source_kind: "bugsjs",
      artifact_sha256: "a".repeat(64),
    }).valid).toBe(false);
    expect(validator.validateSourceLock({
      schema_version: "prvc.source-lock/v1",
      source_kind: "generated-prvc-fixtures",
      artifact_sha256: "not-a-sha",
    }).valid).toBe(false);
  });

  it("should reject malformed candidate, certification, and quarantine payloads using Ajv schema validation", () => {
    const invalidCert = validator.validateCertification({
      schema_version: "prvc.certification/v1",
      level: "INVALID_LEVEL",
    });
    expect(invalidCert.valid).toBe(false);
    expect(invalidCert.errors.length).toBeGreaterThan(0);

    const invalidCand = validator.validateCandidate({
      schema_version: "prvc.candidate/v2",
      candidate_id: "invalid_candidate_id_without_prefix",
    });
    expect(invalidCand.valid).toBe(false);
    expect(invalidCand.errors.length).toBeGreaterThan(0);

    const invalidQuar = validator.validateQuarantine({
      schema_version: "prvc.quarantine/v2",
      candidate_id: "candidate.001",
      stage: "INVALID_STAGE",
    });
    expect(invalidQuar.valid).toBe(false);
    expect(invalidQuar.errors.length).toBeGreaterThan(0);
  });
});
