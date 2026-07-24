/* eslint-disable @typescript-eslint/no-explicit-any -- Ajv's ESM/CJS compatibility boundary is dynamic. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { hashCanonicalJson } from "./jcs.js";
import type { PrvcCase, PrvcOracle } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const Ajv2020 = (Ajv2020Import as any).default || Ajv2020Import;
const addFormats = (addFormatsImport as any).default || addFormatsImport;

export const REPRODUCIBILITY_LEVELS = [
  "CANDIDATE",
  "REPRODUCED",
  "STABLE",
  "PORTABLE",
  "QUARANTINED",
] as const;

export const EVIDENCE_REQUIRED_REPRODUCIBILITY_LEVELS = new Set<string>([
  "REPRODUCED",
  "STABLE",
  "PORTABLE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunSummaryConsistent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { attempts, expected_outcomes: expected, unexpected_outcomes: unexpected, pass_rate: passRate } = value;
  if (
    typeof attempts !== "number" || typeof expected !== "number" || typeof unexpected !== "number" ||
    typeof passRate !== "number" || !Number.isInteger(attempts) || !Number.isInteger(expected) ||
    !Number.isInteger(unexpected) || attempts <= 0 || expected < 0 || unexpected < 0
  ) {
    return false;
  }
  return expected + unexpected === attempts && Math.abs(passRate - expected / attempts) < Number.EPSILON;
}

export class PrvcValidator {
  private ajv: InstanceType<typeof Ajv2020>;
  private caseValidate: ValidateFunction;
  private oracleValidate: ValidateFunction;
  private certificationValidate: ValidateFunction;
  private candidateValidate: ValidateFunction;
  private quarantineValidate: ValidateFunction;
  private sourceLockValidate: ValidateFunction;

  private runStatuses: Set<string>;
  private verdicts: Set<string>;
  private reasonCodes: Set<string>;
  private stageTypes: Set<string>;

  constructor(baseDir?: string) {
    const rootDir = baseDir || join(__dirname, "..");
    const vocabDir = join(rootDir, "vocabulary");
    const schemaDir = join(rootDir, "schemas");

    this.runStatuses = new Set(
      JSON.parse(readFileSync(join(vocabDir, "run-status.json"), "utf8"))
    );
    this.verdicts = new Set(
      JSON.parse(readFileSync(join(vocabDir, "verdict.json"), "utf8"))
    );
    this.reasonCodes = new Set(
      JSON.parse(readFileSync(join(vocabDir, "reason-codes.json"), "utf8"))
    );
    this.stageTypes = new Set(
      JSON.parse(readFileSync(join(vocabDir, "stage-types.json"), "utf8"))
    );

    this.ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(this.ajv);

    const caseSchema = JSON.parse(readFileSync(join(schemaDir, "case.schema.json"), "utf8"));
    const oracleSchema = JSON.parse(readFileSync(join(schemaDir, "oracle.schema.json"), "utf8"));
    const certSchema = JSON.parse(readFileSync(join(schemaDir, "certification.schema.json"), "utf8"));
    const candidateSchema = JSON.parse(readFileSync(join(schemaDir, "candidate-record.schema.json"), "utf8"));
    const quarantineSchema = JSON.parse(readFileSync(join(schemaDir, "quarantine-record.schema.json"), "utf8"));
    const sourceLockSchema = JSON.parse(readFileSync(join(schemaDir, "source-lock.schema.json"), "utf8"));

    this.caseValidate = this.ajv.compile(caseSchema);
    this.oracleValidate = this.ajv.compile(oracleSchema);
    this.certificationValidate = this.ajv.compile(certSchema);
    this.candidateValidate = this.ajv.compile(candidateSchema);
    this.quarantineValidate = this.ajv.compile(quarantineSchema);
    this.sourceLockValidate = this.ajv.compile(sourceLockSchema);
  }

  public validateCase(caseObj: PrvcCase): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const isSchemaValid = this.caseValidate(caseObj);
    if (!isSchemaValid && this.caseValidate.errors) {
      for (const err of this.caseValidate.errors) {
        errors.push(`Schema Error: ${err.instancePath} ${err.message}`);
      }
    }

    if (caseObj.schema_version !== "prvc.case/v1") {
      errors.push(`Invalid schema_version: ${caseObj.schema_version}`);
    }
    if (!caseObj.case_id || !caseObj.case_id.startsWith("prvc.")) {
      errors.push(`Invalid case_id format: ${caseObj.case_id}`);
    }
    if (!caseObj.variants || Object.keys(caseObj.variants).length === 0) {
      errors.push("Case must define at least one variant");
    }

    // Verify JCS RFC 8785 Hash Integrity
    if (caseObj.integrity && caseObj.integrity.sha256) {
      const { integrity, ...rawCaseWithoutIntegrity } = caseObj;
      void integrity;
      const computedHash = hashCanonicalJson(rawCaseWithoutIntegrity);
      if (computedHash !== caseObj.integrity.sha256) {
        errors.push(
          `CASE_HASH_MISMATCH: expected ${caseObj.integrity.sha256}, calculated ${computedHash}`
        );
      }
    } else {
      errors.push("Case missing required integrity sha256 property");
    }

    return { valid: errors.length === 0, errors };
  }

  public validateOracle(oracleObj: PrvcOracle): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const isSchemaValid = this.oracleValidate(oracleObj);
    if (!isSchemaValid && this.oracleValidate.errors) {
      for (const err of this.oracleValidate.errors) {
        errors.push(`Schema Error: ${err.instancePath} ${err.message}`);
      }
    }

    if (oracleObj.schema_version !== "prvc.oracle/v1") {
      errors.push(`Invalid schema_version: ${oracleObj.schema_version}`);
    }

    for (const [varName, variant] of Object.entries(oracleObj.variants)) {
      const exp = variant.expected;
      if (!this.runStatuses.has(exp.terminal_status)) {
        errors.push(`Variant ${varName}: unknown terminal_status ${exp.terminal_status}`);
      }
      if (!this.verdicts.has(exp.verdict)) {
        errors.push(`Variant ${varName}: unknown verdict ${exp.verdict}`);
      }
      if (!this.reasonCodes.has(exp.reason_code)) {
        errors.push(`Variant ${varName}: unknown reason_code ${exp.reason_code}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  public validateCertification(certObj: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const isSchemaValid = this.certificationValidate(certObj);
    if (!isSchemaValid && this.certificationValidate.errors) {
      for (const err of this.certificationValidate.errors) {
        errors.push(`Schema Error: ${err.instancePath} ${err.message}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  public validateCandidate(candObj: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const isSchemaValid = this.candidateValidate(candObj);
    if (!isSchemaValid && this.candidateValidate.errors) {
      for (const err of this.candidateValidate.errors) {
        errors.push(`Schema Error: ${err.instancePath} ${err.message}`);
      }
    }

    // Imported records without an exact source revision and run evidence must
    // remain candidates. This prevents an import from becoming a certification
    // merely by filling a schema-shaped record with placeholder provenance.
    if (isRecord(candObj) && isRecord(candObj.source) && candObj.source.kind === "imported-unverified") {
      const sourceEvidenceFields = [
        "dataset_repository_url",
        "dataset_revision_sha",
        "upstream_instance_id",
        "upstream_repository_url",
      ];
      for (const field of sourceEvidenceFields) {
        if (field in candObj.source) {
          errors.push(`Imported-unverified candidate must not claim source evidence: ${field}`);
        }
      }

      const reproducibility = candObj.reproducibility;
      if (isRecord(reproducibility)) {
        if (reproducibility.level !== "CANDIDATE") {
          errors.push("Imported-unverified candidate must use reproducibility level CANDIDATE");
        }
        for (const runField of ["buggy_runs", "fixed_runs"]) {
          const run = reproducibility[runField];
          if (isRecord(run) && Object.values(run).some((value) => typeof value === "number" && value !== 0)) {
            errors.push(`Imported-unverified candidate must record zero ${runField}`);
          }
        }
        if (Array.isArray(reproducibility.hosts) && reproducibility.hosts.length > 0) {
          errors.push("Imported-unverified candidate must not claim execution hosts");
        }
      }

      if (isRecord(candObj.decision) && candObj.decision.status !== "pending") {
        errors.push("Imported-unverified candidate decision must remain pending");
      }
    }

    if (isRecord(candObj) && isRecord(candObj.reproducibility) && isRecord(candObj.decision)) {
      const evidenceRequired =
        EVIDENCE_REQUIRED_REPRODUCIBILITY_LEVELS.has(String(candObj.reproducibility.level)) ||
        candObj.decision.status === "accepted";
      if (evidenceRequired) {
        for (const runField of ["buggy_runs", "fixed_runs"]) {
          if (!isRunSummaryConsistent(candObj.reproducibility[runField])) {
            errors.push(`Evidence-bearing candidate requires consistent nonzero ${runField}`);
          }
        }
        if (!Array.isArray(candObj.reproducibility.hosts) || candObj.reproducibility.hosts.length === 0) {
          errors.push("Evidence-bearing candidate requires at least one execution host");
        }
        if (typeof candObj.reproducibility.evidence_path !== "string" || candObj.reproducibility.evidence_path.length === 0) {
          errors.push("Evidence-bearing candidate requires a run evidence_path");
        }
        if (typeof candObj.reproducibility.verified_at !== "string" || candObj.reproducibility.verified_at.length === 0) {
          errors.push("Evidence-bearing candidate requires verified_at run evidence");
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  public validateQuarantine(quarObj: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const isSchemaValid = this.quarantineValidate(quarObj);
    if (!isSchemaValid && this.quarantineValidate.errors) {
      for (const err of this.quarantineValidate.errors) {
        errors.push(`Schema Error: ${err.instancePath} ${err.message}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  public validateSourceLock(lockObj: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const isSchemaValid = this.sourceLockValidate(lockObj);
    if (!isSchemaValid && this.sourceLockValidate.errors) {
      for (const err of this.sourceLockValidate.errors) {
        errors.push(`Schema Error: ${err.instancePath} ${err.message}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  public evaluateMetamorphicRelations(
    oracleObj: PrvcOracle
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!oracleObj.relations) return { valid: true, errors: [] };

    for (const rel of oracleObj.relations) {
      if (rel.type === "fail-to-pass") {
        const fromVariant = rel.from && oracleObj.variants[rel.from];
        const toVariant = rel.to && oracleObj.variants[rel.to];
        if (fromVariant && toVariant) {
          if (fromVariant.expected.verdict !== "FAIL") {
            errors.push(`fail-to-pass relation: variant '${rel.from}' verdict is not FAIL`);
          }
          if (toVariant.expected.verdict !== "PASS") {
            errors.push(`fail-to-pass relation: variant '${rel.to}' verdict is not PASS`);
          }
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }
}
