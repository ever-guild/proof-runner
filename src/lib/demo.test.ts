import { describe, expect, it } from "vitest"
import { demoReceipts, getDemoKind, isCanonicalGitHubRepository, isNonFailStatus } from "./demo"
import { extractReceiptVerdict } from "../pages/ReceiptPage"

describe("demo route mapping", () => {
  it("keeps the broken example visibly failed with demo-broken tag", () => {
    expect(getDemoKind(undefined, "/examples/broken")).toBe("broken")
    expect(demoReceipts.broken.verdict).toBe("FAIL")
    expect(demoReceipts.broken.gitTag).toBe("demo-broken")
    expect(demoReceipts.broken.checks).toContainEqual({
      name: "Unit tests",
      outcome: "FAILED",
    })
    expect(demoReceipts.broken.repository).toBe("ever-guild/proof-runner")
    expect(demoReceipts.broken.commit).toBe("339a3effb97cac6073cd5cf8dab746eca25cd255")
  })

  it("maps pass aliases to the passing fixture with demo-fixed tag", () => {
    expect(getDemoKind("demo-123", "/receipts/demo-123")).toBe("passed")
    expect(getDemoKind(undefined, "/examples/passed")).toBe("passed")
    expect(demoReceipts.passed.verdict).toBe("PASS")
    expect(demoReceipts.passed.gitTag).toBe("demo-fixed")
    expect(demoReceipts.passed.commit).toBe("bd3e75e74c099b9fc4eba5504f91dcad4969b60e")
  })

  it("maps timeout, system-error, and inconclusive demo routes correctly", () => {
    expect(getDemoKind("timeout", "/examples/timeout")).toBe("timeout")
    expect(demoReceipts.timeout.status).toBe("TIMEOUT")
    expect(demoReceipts.timeout.gitTag).toBe("demo-timeout")

    expect(getDemoKind("system-error", "/examples/system-error")).toBe("system-error")
    expect(demoReceipts["system-error"].status).toBe("SYSTEM_ERROR")
    expect(demoReceipts["system-error"].gitTag).toBe("demo-system-error")

    expect(getDemoKind("inconclusive", "/examples/inconclusive")).toBe("inconclusive")
    expect(demoReceipts.inconclusive.verdict).toBe("INCONCLUSIVE")
    expect(demoReceipts.inconclusive.gitTag).toBe("demo-inconclusive")
  })
})

describe("repository input validation", () => {
  it("accepts only canonical public GitHub repository URLs", () => {
    expect(isCanonicalGitHubRepository("https://github.com/ever-guild/proof-runner")).toBe(true)
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
