import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import jsyaml from "js-yaml";
import { PrvcValidator } from "../src/validator.js";
import { generateAllCases } from "../src/generator.js";
import type { PrvcCase, PrvcOracle } from "../src/types.js";

describe("PRVC 0.1.0 Hackathon Smoke Suite End-to-End Validation", () => {
  const prvcDir = join(__dirname, "..");
  const validator = new PrvcValidator(prvcDir);

  beforeAll(() => {
    generateAllCases(prvcDir);
  });

  it("should validate all 56 cases defined in smoke.yaml", () => {
    const smokePath = join(prvcDir, "suites", "smoke.yaml");
    expect(existsSync(smokePath)).toBe(true);

    const smokeContent = readFileSync(smokePath, "utf8");
    const smokeObj = jsyaml.load(smokeContent) as { cases: string[] };

    expect(smokeObj.cases.length).toBe(56);

    for (const caseId of smokeObj.cases) {
      const caseFile = join(prvcDir, "cases", caseId, "case.yaml");
      const oracleFile = join(prvcDir, "cases", caseId, "oracle.yaml");

      expect(existsSync(caseFile), `caseFile for ${caseId} does not exist`).toBe(true);
      expect(existsSync(oracleFile), `oracleFile for ${caseId} does not exist`).toBe(true);

      const caseObj = jsyaml.load(readFileSync(caseFile, "utf8")) as PrvcCase;
      const oracleObj = jsyaml.load(readFileSync(oracleFile, "utf8")) as PrvcOracle;

      const valCase = validator.validateCase(caseObj);
      expect(valCase.valid, `Case ${caseId} invalid: ${valCase.errors.join(", ")}`).toBe(true);

      const valOracle = validator.validateOracle(oracleObj);
      expect(valOracle.valid, `Oracle ${caseId} invalid: ${valOracle.errors.join(", ")}`).toBe(true);

      const valMeta = validator.evaluateMetamorphicRelations(oracleObj);
      expect(valMeta.valid, `Metamorphic relations ${caseId} invalid: ${valMeta.errors.join(", ")}`).toBe(true);
    }
  });
});
