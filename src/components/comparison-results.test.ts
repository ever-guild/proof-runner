import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import type { ComparisonResult } from "../lib/api"
import { ComparisonResults } from "./comparison-results"

const comparison: ComparisonResult = {
  id: "f".repeat(64),
  baseline: {
    runId: "018f47ac-5d7b-7c20-a1aa-0242ac120201",
    receiptHash: "d".repeat(64),
    commitSha: "1".repeat(40),
    verdict: "FAIL",
    receipt: {},
  },
  candidate: {
    runId: "018f47ac-5d7b-7c20-a1aa-0242ac120202",
    receiptHash: "e".repeat(64),
    commitSha: "2".repeat(40),
    verdict: "PASS",
    receipt: {},
  },
  compatibility: {
    repositoryUrl: "https://github.com/ever-guild/example",
    contractVersion: "1.0",
    skill: {
      name: "node-typescript",
      version: "1",
      hash: "b".repeat(64),
    },
    runtimeImageDigest: `sha256:${"c".repeat(64)}`,
    verificationContractHash: null,
  },
  checks: [
    {
      checkId: "test",
      classification: "RESOLVED",
      baselineOutcome: "FAILED",
      candidateOutcome: "PASSED",
    },
  ],
  driftLabels: ["VERDICT_DRIFT", "CHECK_OUTCOME_DRIFT"],
  links: {
    self: "/api/comparisons/a/b",
    ui: "/compare/a/b",
  },
}

describe("ComparisonResults", () => {
  it("shows both immutable evidence sources and classified changes", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ComparisonResults, { comparison }),
      ),
    )

    expect(html).toContain("Compatible signed evidence")
    expect(html).toContain("RESOLVED")
    expect(html).toContain("VERDICT_DRIFT")
    expect(html).toContain("no patches or fixes are generated")
    expect(html).toContain(
      `/receipts/${comparison.baseline.runId}`,
    )
    expect(html).toContain(
      `/receipts/${comparison.candidate.runId}`,
    )
  })
})
