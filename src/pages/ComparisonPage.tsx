import * as React from "react"
import { AlertCircle, Copy, Download, Loader2 } from "lucide-react"
import { useParams } from "react-router-dom"

import { ComparisonResults } from "../components/comparison-results"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert"
import { Button } from "../components/ui/button"
import {
  getComparison,
  type ComparisonResult,
} from "../lib/api"

export type ComparisonPageState = {
  baseline: string | undefined
  candidate: string | undefined
  comparison: ComparisonResult | null
  error: string
  loading: boolean
}

export type ComparisonPageAction =
  | { type: "ROUTE_CHANGED"; baseline?: string; candidate?: string }
  | {
      type: "FETCH_SUCCESS"
      baseline?: string
      candidate?: string
      comparison: ComparisonResult
    }
  | {
      type: "FETCH_ERROR"
      baseline?: string
      candidate?: string
      error: string
    }

export const initialComparisonPageState: ComparisonPageState = {
  baseline: undefined,
  candidate: undefined,
  comparison: null,
  error: "",
  loading: false,
}

export function comparisonPageReducer(
  state: ComparisonPageState,
  action: ComparisonPageAction,
): ComparisonPageState {
  switch (action.type) {
    case "ROUTE_CHANGED":
      if (!action.baseline || !action.candidate) {
        return {
          baseline: action.baseline,
          candidate: action.candidate,
          comparison: null,
          error: "Two verified run IDs or receipt hashes are required.",
          loading: false,
        }
      }
      return {
        baseline: action.baseline,
        candidate: action.candidate,
        comparison: null,
        error: "",
        loading: true,
      }
    case "FETCH_SUCCESS":
      if (
        action.baseline !== state.baseline ||
        action.candidate !== state.candidate
      ) {
        return state
      }
      return {
        ...state,
        comparison: action.comparison,
        error: "",
        loading: false,
      }
    case "FETCH_ERROR":
      if (
        action.baseline !== state.baseline ||
        action.candidate !== state.candidate
      ) {
        return state
      }
      return {
        ...state,
        comparison: null,
        error: action.error,
        loading: false,
      }
    default:
      return state
  }
}

export function getActiveComparisonState(
  state: ComparisonPageState,
  currentBaseline?: string,
  currentCandidate?: string,
): ComparisonPageState {
  if (
    state.baseline !== currentBaseline ||
    state.candidate !== currentCandidate
  ) {
    if (!currentBaseline || !currentCandidate) {
      return {
        baseline: currentBaseline,
        candidate: currentCandidate,
        comparison: null,
        error: "Two verified run IDs or receipt hashes are required.",
        loading: false,
      }
    }
    return {
      baseline: currentBaseline,
      candidate: currentCandidate,
      comparison: null,
      error: "",
      loading: true,
    }
  }
  return state
}

export function ComparisonPage() {
  const { baseline, candidate } = useParams()
  const [state, dispatch] = React.useReducer(
    comparisonPageReducer,
    initialComparisonPageState,
  )
  const activeState = getActiveComparisonState(state, baseline, candidate)
  const [copyLabel, setCopyLabel] = React.useState("Copy comparison URL")

  React.useEffect(() => {
    dispatch({ type: "ROUTE_CHANGED", baseline, candidate })
    if (!baseline || !candidate) {
      return
    }
    let cancelled = false
    void getComparison(baseline, candidate)
      .then((result) => {
        if (!cancelled) {
          dispatch({
            type: "FETCH_SUCCESS",
            baseline,
            candidate,
            comparison: result,
          })
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          dispatch({
            type: "FETCH_ERROR",
            baseline,
            candidate,
            error:
              requestError instanceof Error
                ? requestError.message
                : "Comparison could not be loaded.",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [baseline, candidate])

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopyLabel("Copied!")
    window.setTimeout(() => setCopyLabel("Copy comparison URL"), 2_000)
  }

  const downloadJson = () => {
    if (!activeState.comparison) return
    const payload = JSON.stringify(activeState.comparison, null, 2)
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `proofrunner-comparison-${activeState.comparison.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (activeState.error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Comparison unavailable</AlertTitle>
          <AlertDescription className="break-all">{activeState.error}</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!activeState.comparison) {
    return (
      <div className="container mx-auto flex max-w-3xl items-center gap-3 px-4 py-16 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
        Loading signed evidence comparison…
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-indigo-300">
            Verified commit comparison
          </p>
          <h1 className="text-3xl font-bold text-white">
            Evidence changed between commits
          </h1>
          <p className="mt-2 break-all text-sm text-slate-400">
            {activeState.comparison.compatibility.repositoryUrl}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="gap-2"
            onClick={() => void copyUrl()}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Copy className="h-3.5 w-3.5" />
            {copyLabel}
          </Button>
          <Button
            className="gap-2"
            onClick={downloadJson}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Download className="h-3.5 w-3.5" />
            Download JSON
          </Button>
        </div>
      </div>
      <ComparisonResults comparison={activeState.comparison} />
    </div>
  )
}
