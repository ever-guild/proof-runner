import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createPublicKey, verify } from "node:crypto";
import { generateAllCases } from "../src/generator.js";

describe("PRVC Dataset Generator", () => {
  const prvcDir = join(__dirname, "..");

  beforeAll(() => {
    generateAllCases(prvcDir);
  });

  it("should generate 56 logical cases and 65 execution variants", () => {
    const casesJsonl = readFileSync(join(prvcDir, "index", "cases.jsonl"), "utf8");
    const variantsJsonl = readFileSync(join(prvcDir, "index", "variants.jsonl"), "utf8");

    const cases = casesJsonl.trim().split("\n");
    const variants = variantsJsonl.trim().split("\n");

    expect(cases.length).toBe(56);
    expect(variants.length).toBe(65);
  });

  it("should generate release manifest with IMPORTED status for smoke suite", () => {
    const manifestPath = join(prvcDir, "manifests", "release-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.prvc_version).toBe("0.1.0");
    expect(manifest.total_cases).toBe(56);
    expect(manifest.total_variants).toBe(65);
    expect(manifest.level).toBe("IMPORTED");
    expect(manifest.fixture_signature).toMatchObject({
      purpose: "reproducible fixture integrity only",
      publisher_authenticity: false,
    });
  });

  it("should generate certification report conforming to certification.schema.json", () => {
    const certPath = join(prvcDir, "manifests", "certification-report.json");
    expect(existsSync(certPath)).toBe(true);

    const cert = JSON.parse(readFileSync(certPath, "utf8"));
    expect(cert.schema_version).toBe("prvc.certification/v1");
    expect(cert.level).toBe("IMPORTED");
    expect(cert.summary.total_cases).toBe(56);
  });

  it("should generate candidate index matching candidates.jsonl with 56 candidate records matching all 56 cases 1:1", () => {
    const candPath = join(prvcDir, "index", "candidates.jsonl");
    expect(existsSync(candPath)).toBe(true);

    const candidates = readFileSync(candPath, "utf8").trim().split("\n");
    expect(candidates.length).toBe(56);

    for (const candLine of candidates) {
      const cand = JSON.parse(candLine);
      expect(cand.schema_version).toBe("prvc.candidate/v2");
      expect(cand.decision.status).toBe("pending");
      expect(cand.reproducibility.level).toBe("CANDIDATE");
      expect(cand.reproducibility.hosts).toEqual([]);
      expect(cand.reproducibility.buggy_runs).toEqual({ attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 });
      expect(cand.reproducibility.fixed_runs).toEqual({ attempts: 0, expected_outcomes: 0, unexpected_outcomes: 0, pass_rate: 0 });
      expect(cand.source).toEqual({ kind: cand.source.kind });
      expect(cand.source).not.toHaveProperty("dataset_repository_url");
      expect(cand.source).not.toHaveProperty("dataset_revision_sha");
      expect(cand.source).not.toHaveProperty("upstream_repository_url");
      expect(cand.variants.buggy).toEqual({ patches: [] });
      expect(cand.variants.fixed).toEqual({ patches: [] });

      // Verify that every candidate's proposed_case_id corresponds to a generated case directory
      const casePath = join(prvcDir, "cases", cand.proposed_case_id, "case.yaml");
      expect(existsSync(casePath), `Case file missing for proposed_case_id ${cand.proposed_case_id}`).toBe(true);
    }
  });

  it("should create adapters/ and generators/ directories", () => {
    expect(existsSync(join(prvcDir, "adapters", "README.md"))).toBe(true);
    expect(existsSync(join(prvcDir, "generators", "README.md"))).toBe(true);
  });

  it("should generate Ed25519 signed manifest with public key", () => {
    expect(existsSync(join(prvcDir, "manifests", "signatures", "release-manifest.sig"))).toBe(true);
    expect(existsSync(join(prvcDir, "manifests", "signatures", "release-key.pub"))).toBe(true);

    const pubKey = readFileSync(join(prvcDir, "manifests", "signatures", "release-key.pub"), "utf8");
    expect(pubKey).toContain("BEGIN PUBLIC KEY");
    const manifest = readFileSync(join(prvcDir, "manifests", "release-manifest.json"));
    const signature = Buffer.from(readFileSync(join(prvcDir, "manifests", "signatures", "release-manifest.sig"), "utf8"), "hex");
    expect(verify(null, manifest, createPublicKey(pubKey), signature)).toBe(true);
  });

  it("should leave imported selection and source-lock evidence pending", () => {
    const selection = JSON.parse(readFileSync(join(prvcDir, "quarantine", "selection-report.json"), "utf8"));
    expect(selection).toEqual({
      schema_version: "prvc.selection-report/v1",
      candidates: 56,
      reproduced: 0,
      gold: 0,
      quarantined: 0,
      reasons: {},
    });
    expect(existsSync(join(prvcDir, "quarantine", "flaky-race-010.json"))).toBe(false);

    const sourceLock = JSON.parse(readFileSync(join(prvcDir, "index", "sources.lock.json"), "utf8"));
    expect(sourceLock.source_kind).toBe("generated-prvc-fixtures");
    expect(sourceLock).not.toHaveProperty("commit_sha");
    expect(sourceLock).not.toHaveProperty("locked_at");
  });
});
