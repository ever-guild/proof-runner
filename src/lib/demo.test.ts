import { describe, expect, it } from "vitest"
import { demoReceipts, getDemoKind, isCanonicalGitHubRepository } from "./demo"

describe("demo route mapping", () => {
  it("keeps the broken example visibly failed", () => {
    expect(getDemoKind(undefined, "/examples/broken")).toBe("broken")
    expect(demoReceipts.broken.verdict).toBe("FAIL")
    expect(demoReceipts.broken.checks).toContainEqual({
      name: "Unit tests",
      outcome: "FAILED",
    })
  })

  it("maps pass aliases to the passing fixture", () => {
    expect(getDemoKind("demo-123", "/receipts/demo-123")).toBe("passed")
    expect(getDemoKind(undefined, "/examples/passed")).toBe("passed")
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
