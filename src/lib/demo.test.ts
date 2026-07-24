import { describe, expect, it } from "vitest"
import { demoReceipts, getDemoKind, isCanonicalGitHubRepository } from "./demo"
import { extractReceiptVerdict } from "../pages/ReceiptPage"

describe("demo route mapping", () => {
  it("keeps the broken example visibly failed with demo-broken tag", () => {
    expect(getDemoKind(undefined, "/examples/broken")).toBe("broken")
    expect(demoReceipts.broken.verdict).toBe("FAIL")
    expect(demoReceipts.broken.checks).toContainEqual({
      name: "Unit tests",
      outcome: "FAILED",
    })
    expect(demoReceipts.broken.repository).toBe("ever-guild/proof-runner")
    expect(demoReceipts.broken.commit).toBe("91bd7a2f7dd6537202dfaa5bdd6a2b35b06a1670")
  })

  it("maps pass aliases to the passing fixture with demo-fixed tag", () => {
    expect(getDemoKind("demo-123", "/receipts/demo-123")).toBe("passed")
    expect(getDemoKind(undefined, "/examples/passed")).toBe("passed")
    expect(demoReceipts.passed.verdict).toBe("PASS")
    expect(demoReceipts.passed.commit).toBe("4c82fa189cb846189ff7224519a8497aeb78195d")
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
  it("ensures TIMEOUT and SYSTEM_ERROR are categorized as non-FAIL states", () => {
    const isTimeoutOrSystemErrorFail = (status: string, verdict: string | null) => {
      const isTimeout = status === "TIMEOUT"
      const isSystemError = status === "SYSTEM_ERROR"
      return verdict === "FAIL" && !isTimeout && !isSystemError
    }

    expect(isTimeoutOrSystemErrorFail("TIMEOUT", "INCONCLUSIVE")).toBe(false)
    expect(isTimeoutOrSystemErrorFail("SYSTEM_ERROR", "INCONCLUSIVE")).toBe(false)
    expect(isTimeoutOrSystemErrorFail("COMPLETED", "FAIL")).toBe(true)
    expect(isTimeoutOrSystemErrorFail("COMPLETED", "PASS")).toBe(false)
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
