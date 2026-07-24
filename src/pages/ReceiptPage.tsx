import * as React from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { AlertOctagon, AlertTriangle, Check, Clock, Copy, Download, XCircle } from "lucide-react"

import { Card, CardContent, CardHeader } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { demoReceipts, getDemoKind } from "../lib/demo"
import { getReceipt } from "../lib/api"

export function ReceiptPage() {
  const { id } = useParams()
  const location = useLocation()
  const isDemo =
    id === "passed" ||
    id === "broken" ||
    id === "timeout" ||
    id === "system-error" ||
    id === "inconclusive" ||
    location.pathname.startsWith("/examples/")
  return isDemo ? <DemoReceiptPage /> : <LiveReceiptPage id={id} />
}


function updateOpenGraphMeta(title: string, description: string, url: string) {
  document.title = title
  const setMeta = (attr: "property" | "name", key: string, content: string) => {
    let element = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
    if (!element) {
      element = document.createElement("meta")
      element.setAttribute(attr, key)
      document.head.appendChild(element)
    }
    element.content = content
  }
  setMeta("property", "og:title", title)
  setMeta("property", "og:description", description)
  setMeta("property", "og:url", url)
  setMeta("property", "og:type", "website")
  setMeta("name", "twitter:card", "summary_large_image")
  setMeta("name", "twitter:title", title)
  setMeta("name", "twitter:description", description)
}

export function extractReceiptVerdict(data: unknown): string {
  if (!data || typeof data !== "object") return "INCONCLUSIVE"
  const obj = data as Record<string, unknown>
  const payload = obj.payload as Record<string, unknown> | undefined
  const payloadReport = payload?.report as Record<string, unknown> | undefined
  const report = obj.report as Record<string, unknown> | undefined

  if (typeof payloadReport?.verdict === "string") return payloadReport.verdict
  if (typeof report?.verdict === "string") return report.verdict
  if (typeof obj.verdict === "string") return obj.verdict
  return "INCONCLUSIVE"
}

function LiveReceiptPage({ id }: { id: string | undefined }) {
  const [receipt, setReceipt] = React.useState<unknown>(null)
  const [error, setError] = React.useState("")
  const [copyLabel, setCopyLabel] = React.useState("Copy receipt URL")

  React.useEffect(() => {
    if (!id) return
    void getReceipt(id).then((data) => {
      setReceipt(data)
      const verdict = extractReceiptVerdict(data)
      const title = `Verification Receipt ${id} · ${verdict} · ProofRunner`
      const desc = `Signed verification evidence receipt for run ${id} with verdict ${verdict}.`
      updateOpenGraphMeta(title, desc, window.location.href)
    }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Receipt could not be loaded."))
  }, [id])

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopyLabel("Copied!")
    setTimeout(() => setCopyLabel("Copy receipt URL"), 2000)
  }

  if (error) return <div className="container mx-auto max-w-3xl px-4 py-16 text-fail break-all">{error}</div>
  if (!receipt) return <div className="container mx-auto max-w-3xl px-4 py-16 text-slate-300">Loading signed receipt…</div>

  const payload = JSON.stringify(receipt, null, 2)
  const downloadJson = () => {
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `proofrunner-receipt-${id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl animate-fade-in-up">
      <div className="mb-8 text-center">
        <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-indigo-300">Signed receipt</p>
        <h1 className="text-3xl font-bold text-white mb-2">Verification evidence</h1>
        <p className="text-slate-400 font-mono text-xs break-all">Run {id}</p>
      </div>
      <Card className="mb-8">
        <CardHeader className="border-b border-white/5 bg-black/20 flex flex-row items-center justify-between">
          <h2 className="tracking-wider uppercase text-sm font-semibold text-slate-400">Canonical receipt JSON</h2>
          <Button type="button" variant="secondary" size="sm" className="gap-2" onClick={() => void copyUrl()}>
            <Copy className="w-3.5 h-3.5" /> {copyLabel}
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300 font-mono p-4 bg-black/40 rounded-lg">{payload}</pre>
        </CardContent>
      </Card>
      <div className="flex flex-wrap justify-center gap-4">
        <Button type="button" variant="secondary" className="gap-2" onClick={downloadJson}>
          <Download className="w-4 h-4" /> Download signed JSON
        </Button>
      </div>
    </div>
  )
}

function DemoReceiptPage() {
  const { id } = useParams()
  const location = useLocation()
  const kind = getDemoKind(id, location.pathname)
  const receipt = demoReceipts[kind]
  const [copyLabel, setCopyLabel] = React.useState("Copy demo URL")
  const tagLabel = receipt.gitTag


  const badgeVariantMap: Record<string, "pass" | "fail" | "timeout" | "system_error" | "inconclusive"> = {
    PASS: "pass",
    FAIL: "fail",
    TIMEOUT: "timeout",
    SYSTEM_ERROR: "system_error",
    INCONCLUSIVE: "inconclusive",
  }

  const displayVerdict = receipt.status === "TIMEOUT" ? "TIMEOUT"
    : receipt.status === "SYSTEM_ERROR" ? "SYSTEM_ERROR"
      : receipt.verdict
  const badgeVariant = badgeVariantMap[displayVerdict] ?? "inconclusive"

  React.useEffect(() => {
    const title = `${displayVerdict} Demo Receipt (${tagLabel}) · ProofRunner`
    const desc = `Demo verification evidence receipt for ${receipt.repository} at tag ${tagLabel}.`
    updateOpenGraphMeta(title, desc, window.location.href)
  }, [displayVerdict, receipt.repository, tagLabel])

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopyLabel("Copied!")
    setTimeout(() => setCopyLabel("Copy demo URL"), 2000)
  }

  const downloadJson = () => {
    const payload = JSON.stringify({ demo: true, gitTag: tagLabel, ...receipt }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `proofrunner-demo-${kind}-${tagLabel}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl animate-fade-in-up">
      <div className="mb-12 text-center">
        <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-amber-300">
          Demonstration data — not a signed production receipt
        </p>
        <h1 className="text-3xl font-bold text-white mb-4 flex items-center justify-center gap-3">
          {displayVerdict === "FAIL" && <XCircle className="w-8 h-8 text-fail" />}
          {displayVerdict === "TIMEOUT" && <Clock className="w-8 h-8 text-amber-400" />}
          {displayVerdict === "SYSTEM_ERROR" && <AlertOctagon className="w-8 h-8 text-rose-400" />}
          {displayVerdict === "INCONCLUSIVE" && <AlertTriangle className="w-8 h-8 text-amber-400" />}
          {displayVerdict === "PASS" && <Check className="w-8 h-8 text-pass" />}
          Demo verification {displayVerdict.toLowerCase()}
        </h1>
        <p className="text-slate-400 max-w-xl mx-auto">{receipt.summary}</p>
      </div>

      <Card className={`relative overflow-hidden mb-8 border ${
        displayVerdict === "FAIL" ? "border-fail/30"
          : displayVerdict === "TIMEOUT" || displayVerdict === "INCONCLUSIVE" ? "border-amber-500/30"
            : displayVerdict === "SYSTEM_ERROR" ? "border-rose-500/30"
              : "border-pass/30"
      }`}>
        <div className={`absolute -top-24 -right-24 w-64 h-64 blur-[100px] rounded-full pointer-events-none ${
          displayVerdict === "FAIL" ? "bg-fail/20"
            : displayVerdict === "TIMEOUT" || displayVerdict === "INCONCLUSIVE" ? "bg-amber-500/20"
              : displayVerdict === "SYSTEM_ERROR" ? "bg-rose-500/20"
                : "bg-pass/20"
        }`} />
        <CardHeader className="border-b border-white/5 bg-black/20">
          <div className="flex items-center justify-between">
            <h2 className="tracking-wider uppercase text-sm font-semibold text-slate-400">Demo receipt</h2>
            <Badge variant={badgeVariant}>
              {displayVerdict}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <dl className="divide-y divide-white/5 text-sm font-mono">
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Repository</dt><dd className="col-span-2 text-slate-300 break-all">{receipt.repository}</dd></div>
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Git Tag</dt><dd className="col-span-2 text-indigo-300 font-semibold">{tagLabel}</dd></div>
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Code commit</dt><dd className="col-span-2 text-slate-300 break-all">{receipt.commit}</dd></div>
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Verification skill</dt><dd className="col-span-2 text-slate-300 break-all">{receipt.skill}</dd></div>
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Report hash</dt><dd className="col-span-2 text-indigo-400 break-all">{receipt.reportHash}</dd></div>
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Signature</dt><dd className="col-span-2 text-slate-400">Not issued for demo data</dd></div>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-center gap-4 mb-16">
        <Button type="button" variant="secondary" className="gap-2" onClick={() => void copyUrl()}>
          <Copy className="w-4 h-4" /> {copyLabel}
        </Button>
        <Button type="button" variant="secondary" className="gap-2" onClick={downloadJson}>
          <Download className="w-4 h-4" /> Download demo JSON
        </Button>
        <Button asChild><Link to="/#verify">Preview another commit</Link></Button>
      </div>

      <p className="text-xs text-center text-slate-500 max-w-xl mx-auto leading-relaxed border border-yellow-500/20 bg-yellow-500/5 p-4 rounded-xl">
        A production receipt will describe the checks executed against an exact commit and runtime. It will not prove the absence of all defects or security vulnerabilities.
      </p>
    </div>
  )
}
