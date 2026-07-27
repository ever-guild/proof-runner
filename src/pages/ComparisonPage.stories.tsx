import type { Meta, StoryObj } from "@storybook/react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { Navigate, Route, Routes, useNavigate } from "react-router-dom"

import { ComparisonPage } from "./ComparisonPage"
import type { ComparisonResult } from "../lib/api"

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
    repositoryUrl: "https://github.com/ever-guild/example-repo-a",
    contractVersion: "1.0",
    skill: { name: "node-typescript", version: "1", hash: "c".repeat(64) },
    runtimeImageDigest: `sha256:${"d".repeat(64)}`,
    verificationContractHash: null,
  },
  checks: [],
  driftLabels: [],
  links: {
    self: "/api/comparisons/runA1/runA2",
    ui: "/compare/runA1/runA2",
  },
}

const dummyComparisonB: ComparisonResult = {
  id: "b".repeat(64),
  baseline: {
    runId: "018f47ac-5d7b-7c20-a1aa-0242ac120103",
    receiptHash: "c".repeat(64),
    commitSha: "3".repeat(40),
    verdict: "FAIL",
    receipt: {},
  },
  candidate: {
    runId: "018f47ac-5d7b-7c20-a1aa-0242ac120104",
    receiptHash: "d".repeat(64),
    commitSha: "4".repeat(40),
    verdict: "PASS",
    receipt: {},
  },
  compatibility: {
    repositoryUrl: "https://github.com/ever-guild/example-repo-b",
    contractVersion: "1.0",
    skill: { name: "node-typescript", version: "1", hash: "c".repeat(64) },
    runtimeImageDigest: `sha256:${"d".repeat(64)}`,
    verificationContractHash: null,
  },
  checks: [],
  driftLabels: [],
  links: {
    self: "/api/comparisons/runB1/runB2",
    ui: "/compare/runB1/runB2",
  },
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const originalFetch = globalThis.fetch

type DeferredHarness = {
  deferredA: ReturnType<typeof createDeferred<ComparisonResult>>
  deferredB: ReturnType<typeof createDeferred<ComparisonResult>>
  restore: () => void
}

let activeHarness: DeferredHarness | null = null

function setupDeferredFetch(): DeferredHarness {
  const deferredA = createDeferred<ComparisonResult>()
  const deferredB = createDeferred<ComparisonResult>()

  const mockFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (url.includes("/api/comparisons/runA1/runA2")) {
      const data = await deferredA.promise
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url.includes("/api/comparisons/runB1/runB2")) {
      const data = await deferredB.promise
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    return originalFetch(input, init)
  }

  globalThis.fetch = mockFetch as typeof globalThis.fetch

  const harness: DeferredHarness = {
    deferredA,
    deferredB,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
  return harness
}

function ComparisonTestHarness() {
  const navigate = useNavigate()
  return (
    <div>
      <div className="p-4 bg-slate-900 border-b border-slate-800 flex gap-4">
        <button
          type="button"
          onClick={() => navigate("/compare/runA1/runA2")}
          className="px-3 py-1 bg-indigo-600 text-white rounded text-sm"
        >
          Route A
        </button>
        <button
          type="button"
          onClick={() => navigate("/compare/runB1/runB2")}
          className="px-3 py-1 bg-indigo-600 text-white rounded text-sm"
        >
          Route B
        </button>
      </div>
      <Routes>
        <Route
          path="/compare/:baseline/:candidate"
          element={<ComparisonPage />}
        />
        <Route
          path="*"
          element={<Navigate to="/compare/runA1/runA2" replace />}
        />
      </Routes>
    </div>
  )
}

const meta = {
  title: "Pages/ComparisonPage",
  component: ComparisonTestHarness,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => {
      if (activeHarness) {
        activeHarness.restore()
      }
      activeHarness = setupDeferredFetch()
      return <Story />
    },
  ],
} satisfies Meta<typeof ComparisonTestHarness>

export default meta
type Story = StoryObj<typeof meta>

export const ImmediateRouteTransitionClearsState: Story = {
  play: async ({ canvasElement }) => {
    const harness = activeHarness!
    try {
      const canvas = within(canvasElement)

      // Resolve A so A evidence is displayed first
      harness.deferredA.resolve(dummyComparisonA)

      await waitFor(
        () =>
          expect(canvas.getByText("Download JSON")).toBeInTheDocument(),
        { timeout: 5_000 },
      )
      await expect(
        canvas.getByText("https://github.com/ever-guild/example-repo-a"),
      ).toBeInTheDocument()

      // Navigate to Route B (runB1/runB2) while B fetch is pending
      const routeBBtn = canvas.getByRole("button", { name: "Route B" })
      await userEvent.click(routeBBtn)

      // Immediately (while B is pending), A evidence & Download JSON must be removed
      await expect(canvas.queryByText("Download JSON")).not.toBeInTheDocument()
      await expect(
        canvas.queryByText("https://github.com/ever-guild/example-repo-a"),
      ).not.toBeInTheDocument()
      await expect(
        canvas.getByText(/Loading signed evidence comparison/i),
      ).toBeInTheDocument()

      // Resolve B to complete the scenario
      harness.deferredB.resolve(dummyComparisonB)

      await waitFor(
        () =>
          expect(canvas.getByText("Download JSON")).toBeInTheDocument(),
        { timeout: 5_000 },
      )
      await expect(
        canvas.getByText("https://github.com/ever-guild/example-repo-b"),
      ).toBeInTheDocument()
    } finally {
      harness.restore()
      activeHarness = null
    }
  },
}

export const StaleResponseIgnoredOnNewRoute: Story = {
  play: async ({ canvasElement }) => {
    const harness = activeHarness!
    try {
      const canvas = within(canvasElement)

      // Navigate to Route B before Route A fetch resolves
      const routeBBtn = canvas.getByRole("button", { name: "Route B" })
      await userEvent.click(routeBBtn)

      // Stale Route A fetch resolves now while route B is active
      harness.deferredA.resolve(dummyComparisonA)

      // Wait a tick to ensure promise resolution processed
      await new Promise((res) => setTimeout(res, 100))

      // Stale A data must NOT populate under Route B
      await expect(canvas.queryByText("Download JSON")).not.toBeInTheDocument()
      await expect(
        canvas.queryByText("https://github.com/ever-guild/example-repo-a"),
      ).not.toBeInTheDocument()
      await expect(
        canvas.getByText(/Loading signed evidence comparison/i),
      ).toBeInTheDocument()

      // Resolve B
      harness.deferredB.resolve(dummyComparisonB)

      await waitFor(
        () =>
          expect(canvas.getByText("Download JSON")).toBeInTheDocument(),
        { timeout: 5_000 },
      )
      await expect(
        canvas.getByText("https://github.com/ever-guild/example-repo-b"),
      ).toBeInTheDocument()
    } finally {
      harness.restore()
      activeHarness = null
    }
  },
}
