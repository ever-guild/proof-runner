import { describe, expect, it } from "vitest"
import type { ComparisonResult } from "../lib/api"
import {
  comparisonPageReducer,
  getActiveComparisonState,
  initialComparisonPageState,
} from "./ComparisonPage"

const dummyComparisonA: ComparisonResult = {
  id: "a".repeat(64),
  baseline: {
    runId: "018f47ac-5d7b-7c20-a1aa-0242ac120101",
    receiptHash: "a".repeat(64),
    commitSha: "1".repeat(40),
    verdict: "FAIL",
    receipt: {},
  },
  candidate: {
    runId: "018f47ac-5d7b-7c20-a1aa-0242ac120102",
    receiptHash: "b".repeat(64),
    commitSha: "2".repeat(40),
    verdict: "PASS",
    receipt: {},
  },
  compatibility: {
    repositoryUrl: "https://github.com/ever-guild/example",
    contractVersion: "1.0",
    skill: { name: "node-typescript", version: "1", hash: "c".repeat(64) },
    runtimeImageDigest: `sha256:${"d".repeat(64)}`,
    verificationContractHash: null,
  },
  checks: [],
  driftLabels: [],
  links: {
    self: "/api/comparisons/runA/runB",
    ui: "/compare/runA/runB",
  },
}

describe("ComparisonPage route-transition state logic", () => {
  it("immediately clears comparison and error whenever baseline or candidate changes", () => {
    // Populate state with route A results
    let state = comparisonPageReducer(initialComparisonPageState, {
      type: "ROUTE_CHANGED",
      baseline: "runA1",
      candidate: "runA2",
    })
    expect(state.loading).toBe(true)

    state = comparisonPageReducer(state, {
      type: "FETCH_SUCCESS",
      baseline: "runA1",
      candidate: "runA2",
      comparison: dummyComparisonA,
    })
    expect(state.comparison).toBe(dummyComparisonA)
    expect(state.loading).toBe(false)

    // Route transitions to route B
    state = comparisonPageReducer(state, {
      type: "ROUTE_CHANGED",
      baseline: "runB1",
      candidate: "runB2",
    })

    // Comparison and error must be immediately cleared, loading set to true
    expect(state.comparison).toBeNull()
    expect(state.error).toBe("")
    expect(state.loading).toBe(true)
    expect(state.baseline).toBe("runB1")
    expect(state.candidate).toBe("runB2")
  })

  it("ignores stale completion responses from previous route parameters", () => {
    let state = comparisonPageReducer(initialComparisonPageState, {
      type: "ROUTE_CHANGED",
      baseline: "runA1",
      candidate: "runA2",
    })

    // Route transitions to route B before route A fetch resolves
    state = comparisonPageReducer(state, {
      type: "ROUTE_CHANGED",
      baseline: "runB1",
      candidate: "runB2",
    })

    // Stale FETCH_SUCCESS from route A resolves
    const stateAfterStaleSuccess = comparisonPageReducer(state, {
      type: "FETCH_SUCCESS",
      baseline: "runA1",
      candidate: "runA2",
      comparison: dummyComparisonA,
    })
    expect(stateAfterStaleSuccess).toBe(state)
    expect(stateAfterStaleSuccess.comparison).toBeNull()
    expect(stateAfterStaleSuccess.loading).toBe(true)

    // Stale FETCH_ERROR from route A resolves
    const stateAfterStaleError = comparisonPageReducer(state, {
      type: "FETCH_ERROR",
      baseline: "runA1",
      candidate: "runA2",
      error: "Stale fetch error",
    })
    expect(stateAfterStaleError).toBe(state)
    expect(stateAfterStaleError.error).toBe("")
  })

  it("sets unavailable error when route parameters are missing", () => {
    const state = comparisonPageReducer(initialComparisonPageState, {
      type: "ROUTE_CHANGED",
      baseline: "runA1",
      candidate: undefined,
    })
    expect(state.error).toBe("Two verified run IDs or receipt hashes are required.")
    expect(state.loading).toBe(false)
    expect(state.comparison).toBeNull()
  })

  it("synchronously resolves active view state on immediate render when route parameters change before effects run", () => {
    // State holds prior completed comparison for route A (runA1, runA2)
    const priorState = {
      baseline: "runA1",
      candidate: "runA2",
      comparison: dummyComparisonA,
      error: "",
      loading: false,
    }

    // Immediately on render of route B (runB1, runB2) before useEffect fires:
    const activeState = getActiveComparisonState(priorState, "runB1", "runB2")

    // The active view state must treat mismatched prior state as loading with no old comparison/actions/error
    expect(activeState.comparison).toBeNull()
    expect(activeState.error).toBe("")
    expect(activeState.loading).toBe(true)
    expect(activeState.baseline).toBe("runB1")
    expect(activeState.candidate).toBe("runB2")
  })
})
