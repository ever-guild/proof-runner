import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import {
  EvidenceBundleVerificationPage,
  evidenceBundleFailureMessage,
} from "./EvidenceBundleVerificationPage"

describe("EvidenceBundleVerificationPage", () => {
  it("renders a bounded archive upload and explains local verification", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(EvidenceBundleVerificationPage),
      ),
    )
    expect(html).toContain("Verify an evidence bundle")
    expect(html).toContain("up to 4 MiB")
    expect(html).toContain("without contacting the source repository")
    expect(html).toContain('type="file"')
  })

  it("turns stable failure codes into actionable messages", () => {
    expect(evidenceBundleFailureMessage("CHECKSUM_MISMATCH")).toContain(
      "modified",
    )
    expect(
      evidenceBundleFailureMessage("INVALID_MANIFEST_SIGNATURE"),
    ).toContain("signature")
  })
})
