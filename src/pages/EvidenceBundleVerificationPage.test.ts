import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import {
  EvidenceBundleVerificationPage,
  evidenceBundleFailureMessage,
  initialVerificationState,
  verificationReducer,
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

  it("prevents older stale completion responses from populating state after new selection or submission", () => {
    const fileA = new File(["dummyA"], "archiveA.zip", { type: "application/zip" })
    const fileB = new File(["dummyB"], "archiveB.zip", { type: "application/zip" })

    // Step 1: Select Archive A (gen 1)
    let state = verificationReducer(initialVerificationState, {
      type: "SELECT_ARCHIVE",
      archive: fileA,
    })
    expect(state.generation).toBe(1)
    expect(state.archive).toBe(fileA)

    // Step 2: Start Verification of A (gen 1)
    state = verificationReducer(state, {
      type: "START_VERIFICATION",
      generation: 1,
    })
    expect(state.verifying).toBe(true)

    // Step 3: Select Archive B (gen 2)
    state = verificationReducer(state, {
      type: "SELECT_ARCHIVE",
      archive: fileB,
    })
    expect(state.generation).toBe(2)
    expect(state.archive).toBe(fileB)
    expect(state.verifying).toBe(false)

    // Step 4: Start Verification of B (gen 2)
    state = verificationReducer(state, {
      type: "START_VERIFICATION",
      generation: 2,
    })
    expect(state.generation).toBe(2)
    expect(state.archive).toBe(fileB)
    expect(state.verifying).toBe(true)

    // Step 5: Stale response A completes with success (gen 1) - must be ignored!
    const staleResult = {
      contractVersion: "1.0" as const,
      valid: true,
      reason: null,
      bundleId: "a".repeat(64),
    }
    const stateAfterStaleSuccess = verificationReducer(state, {
      type: "VERIFICATION_SUCCESS",
      generation: 1,
      result: staleResult,
    })
    expect(stateAfterStaleSuccess).toBe(state)
    expect(stateAfterStaleSuccess.archive).toBe(fileB)
    expect(stateAfterStaleSuccess.verifying).toBe(true)
    expect(stateAfterStaleSuccess.generation).toBe(2)
    expect(stateAfterStaleSuccess.result).toBeNull()
    expect(stateAfterStaleSuccess.error).toBe("")

    // Step 6: Stale response A completes with error (gen 1) - must be ignored!
    const stateAfterStaleError = verificationReducer(state, {
      type: "VERIFICATION_ERROR",
      generation: 1,
      error: "Stale error message",
    })
    expect(stateAfterStaleError).toBe(state)
    expect(stateAfterStaleError.archive).toBe(fileB)
    expect(stateAfterStaleError.verifying).toBe(true)
    expect(stateAfterStaleError.generation).toBe(2)
    expect(stateAfterStaleError.result).toBeNull()
    expect(stateAfterStaleError.error).toBe("")
  })
})
