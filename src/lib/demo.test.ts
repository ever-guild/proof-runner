import { describe, expect, it } from "vitest"
import {
  DEMO_BROKEN_SHA,
  DEMO_BROKEN_TAG,
  DEMO_FIXED_SHA,
  DEMO_FIXED_TAG,
  DEMO_REPOSITORY_URL,
  demoReceipts,
  getDemoKind,
  getDemoOpenGraphMetadata,
  getDemoProgressLabel,
  isCanonicalGitHubRepository,
  isNonFailStatus,
} from "./demo"
import { extractReceiptVerdict } from "../pages/ReceiptPage"

describe("demo route mapping", () => {
  it("keeps the broken example visibly failed with a pinned source reference", () => {
    expect(getDemoKind(undefined, "/examples/broken")).toBe("broken")
    expect(demoReceipts.broken.verdict).toBe("FAIL")
    expect(demoReceipts.broken.source).toBe("pinned-reference")
    expect(demoReceipts.broken.provenance).toEqual({
      repository: "ever-guild/proof-runner-demo",
      gitTag: "demo-broken",
      commit: DEMO_BROKEN_SHA,
    })
    expect(demoReceipts.broken.checks).toContainEqual({
      name: "Unit tests",
      outcome: "FAILED",
    })
    expect(demoReceipts.broken).not.toHaveProperty("reportHash")
  })

  it("maps pass aliases to the pinned passing source reference", () => {
    expect(getDemoKind("demo-123", "/receipts/demo-123")).toBe("passed")
    expect(getDemoKind(undefined, "/examples/passed")).toBe("passed")
    expect(demoReceipts.passed.verdict).toBe("PASS")
    expect(demoReceipts.passed.source).toBe("pinned-reference")
    expect(demoReceipts.passed.provenance).toEqual({
      repository: "ever-guild/proof-runner-demo",
      gitTag: "demo-fixed",
      commit: DEMO_FIXED_SHA,
    })
    expect(demoReceipts.passed).not.toHaveProperty("reportHash")
  })

  it("maps simulated states without inventing repository evidence", () => {
    expect(getDemoKind("timeout", "/examples/timeout")).toBe("timeout")
    expect(demoReceipts.timeout.status).toBe("TIMEOUT")

    expect(getDemoKind("system-error", "/examples/system-error")).toBe("system-error")
    expect(demoReceipts["system-error"].status).toBe("SYSTEM_ERROR")

    expect(getDemoKind("inconclusive", "/examples/inconclusive")).toBe("inconclusive")
    expect(demoReceipts.inconclusive.verdict).toBe("INCONCLUSIVE")
    for (const kind of ["timeout", "system-error", "inconclusive"] as const) {
      const receipt = demoReceipts[kind]
      expect(receipt.source).toBe("simulated")
      expect(receipt).not.toHaveProperty("provenance")
      expect(JSON.stringify(receipt)).not.toMatch(/proof-runner-demo|demo-(timeout|system-error|inconclusive)|[a-f0-9]{40}|reportHash/i)
    }
  })
})

describe("public demo repository tags & SHAs", () => {
  it("points to the public ever-guild/proof-runner-demo repository", () => {
    expect(DEMO_REPOSITORY_URL).toBe("https://github.com/ever-guild/proof-runner-demo")
    expect(demoReceipts.passed.provenance.repository).toBe("ever-guild/proof-runner-demo")
    expect(demoReceipts.broken.provenance.repository).toBe("ever-guild/proof-runner-demo")
  })

  it("resolves demo-broken and demo-fixed to distinct immutable commit SHAs", () => {
    expect(DEMO_BROKEN_TAG).toBe("demo-broken")
    expect(DEMO_FIXED_TAG).toBe("demo-fixed")
    expect(DEMO_BROKEN_SHA).toMatch(/^[a-f0-9]{40}$/)
    expect(DEMO_FIXED_SHA).toMatch(/^[a-f0-9]{40}$/)
    expect(DEMO_BROKEN_SHA).not.toBe(DEMO_FIXED_SHA)
    expect(demoReceipts.broken.provenance.commit).toBe(DEMO_BROKEN_SHA)
    expect(demoReceipts.passed.provenance.commit).toBe(DEMO_FIXED_SHA)
  })
})

describe("demo metadata", () => {
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
  ] as const)("uses truthful %s Open Graph metadata", (kind, title, description) => {
    expect(getDemoOpenGraphMetadata(kind)).toEqual({ title, description })
  })

  it("labels the animation as progress rather than elapsed execution time", () => {
    expect(getDemoProgressLabel(3, 6)).toBe("Demo progress: 3 of 6 stages")
    expect(getDemoProgressLabel(9, 6)).toBe("Demo progress: 6 of 6 stages")
  })
})

describe("repository input validation", () => {
  it("accepts only canonical public GitHub repository URLs", () => {
    expect(isCanonicalGitHubRepository("https://github.com/ever-guild/proof-runner")).toBe(true)
    expect(isCanonicalGitHubRepository(DEMO_REPOSITORY_URL)).toBe(true)
    expect(isCanonicalGitHubRepository("http://github.com/ever-guild/proof-runner")).toBe(false)
    expect(isCanonicalGitHubRepository("https://example.com/ever-guild/proof-runner")).toBe(false)
    expect(isCanonicalGitHubRepository("https://github.com/ever-guild/proof-runner/issues")).toBe(false)
  })
})

describe("verification verdict & status categorization", () => {
  it("ensures TIMEOUT and SYSTEM_ERROR are categorized as non-FAIL states via isNonFailStatus", () => {
    expect(isNonFailStatus("TIMEOUT", "INCONCLUSIVE")).toBe(false)
    expect(isNonFailStatus("SYSTEM_ERROR", "INCONCLUSIVE")).toBe(false)
    expect(isNonFailStatus("COMPLETED", "FAIL")).toBe(true)
    expect(isNonFailStatus("COMPLETED", "PASS")).toBe(false)
  })

  it("extracts verdict correctly from payload.report.verdict response shape", () => {
    const signedReceipt = {
      payload: {
        runId: "run-123",
        report: { verdict: "PASS" },
      },
      signature: "sig",
      publicKey: "key",
    }
    expect(extractReceiptVerdict(signedReceipt)).toBe("PASS")

    const failedReceipt = {
      payload: {
        runId: "run-456",
        report: { verdict: "FAIL" },
      },
    }
    expect(extractReceiptVerdict(failedReceipt)).toBe("FAIL")

    const fallbackReceipt = { verdict: "INCONCLUSIVE" }
    expect(extractReceiptVerdict(fallbackReceipt)).toBe("INCONCLUSIVE")
    expect(extractReceiptVerdict(null)).toBe("INCONCLUSIVE")
  })
})
