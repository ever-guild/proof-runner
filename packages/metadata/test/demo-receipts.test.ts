import { describe, expect, it } from "vitest";
import {
  DEMO_BROKEN_SHA,
  DEMO_FIXED_SHA,
  demoReceipts,
  getDemoReceiptOpenGraphMetadata,
  isDemoKind,
} from "../src/demo-receipts.js";

describe("demo receipt metadata", () => {
  it("keeps PASS and FAIL tied to distinct public source references", () => {
    expect(demoReceipts.passed).toMatchObject({
      source: "pinned-reference",
      provenance: {
        repository: "ever-guild/proof-runner-demo",
        gitTag: "demo-fixed",
        commit: DEMO_FIXED_SHA,
      },
    });
    expect(demoReceipts.broken).toMatchObject({
      source: "pinned-reference",
      provenance: {
        repository: "ever-guild/proof-runner-demo",
        gitTag: "demo-broken",
        commit: DEMO_BROKEN_SHA,
      },
    });
    expect(DEMO_BROKEN_SHA).not.toBe(DEMO_FIXED_SHA);
  });

  it("keeps simulated outcomes free of repository, revision, and report claims", () => {
    for (const kind of ["timeout", "system-error", "inconclusive"] as const) {
      const fixture = demoReceipts[kind];
      expect(fixture.source).toBe("simulated");
      expect(fixture).not.toHaveProperty("provenance");
      expect(JSON.stringify(fixture)).not.toMatch(
        /proof-runner-demo|demo-(timeout|system-error|inconclusive)|[a-f0-9]{40}|reportHash/i,
      );
    }
  });

  it("recognizes only the five explicit demo route kinds", () => {
    expect(isDemoKind("passed")).toBe(true);
    expect(isDemoKind("system-error")).toBe(true);
    expect(isDemoKind("unknown-demo")).toBe(false);
  });

  it.each([
    [
      "passed",
      "[DEMO] PASS Source Reference (demo-fixed) · ProofRunner",
      "Static demo reference for ever-guild/proof-runner-demo at tag demo-fixed. No ProofRunner execution or signed receipt was issued.",
    ],
    [
      "broken",
      "[DEMO] FAIL Source Reference (demo-broken) · ProofRunner",
      "Static demo reference for ever-guild/proof-runner-demo at tag demo-broken. No ProofRunner execution or signed receipt was issued.",
    ],
    [
      "timeout",
      "[DEMO] TIMEOUT Simulation · ProofRunner",
      "Simulated execution-limit example. No repository execution or signed receipt was issued.",
    ],
    [
      "system-error",
      "[DEMO] SYSTEM_ERROR Simulation · ProofRunner",
      "Simulated runner-error example. No repository execution or signed receipt was issued.",
    ],
    [
      "inconclusive",
      "[DEMO] INCONCLUSIVE Simulation · ProofRunner",
      "Simulated incomplete-result example. No repository execution or signed receipt was issued.",
    ],
  ] as const)("produces truthful %s crawler metadata", (kind, title, description) => {
    expect(getDemoReceiptOpenGraphMetadata(kind)).toEqual({ title, description });
  });
});
