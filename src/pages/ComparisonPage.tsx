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

export function ComparisonPage() {
  const { baseline, candidate } = useParams()
  const [comparison, setComparison] = React.useState<ComparisonResult | null>(
    null,
  )
  const [error, setError] = React.useState("")
  const [copyLabel, setCopyLabel] = React.useState("Copy comparison URL")

  React.useEffect(() => {
    if (!baseline || !candidate) {
      setError("Two verified run IDs or receipt hashes are required.")
      return
    }
    let cancelled = false
    void getComparison(baseline, candidate)
      .then((result) => {
        if (!cancelled) setComparison(result)
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Comparison could not be loaded.",
          )
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
    if (!comparison) return
    const payload = JSON.stringify(comparison, null, 2)
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `proofrunner-comparison-${comparison.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Comparison unavailable</AlertTitle>
          <AlertDescription className="break-all">{error}</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!comparison) {
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
            {comparison.compatibility.repositoryUrl}
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
      <ComparisonResults comparison={comparison} />
    </div>
  )
}
