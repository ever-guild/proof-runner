import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AcceptanceDecisionPanel } from "./acceptance-decision"

describe("AcceptanceDecisionPanel", () => {
  it("labels the policy result as unsigned and advisory", () => {
    const html = renderToStaticMarkup(
      createElement(AcceptanceDecisionPanel, {
        decision: {
          policyVersion: "1",
          advisory: true,
          outcome: "HUMAN_REVIEW",
          reasonCodes: ["REQUIRED_COVERAGE_INCOMPLETE"],
        },
      }),
    )

    expect(html).toContain("Advisory acceptance decision")
    expect(html).toContain("HUMAN_REVIEW")
    expect(html).toContain("Policy v1")
    expect(html).toContain("Unsigned")
  })
})
