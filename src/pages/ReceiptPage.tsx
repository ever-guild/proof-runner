import * as React from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { Copy, Download } from "lucide-react"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { demoReceipts, getDemoKind } from "../lib/demo"

export function ReceiptPage() {
  const { id } = useParams()
  const location = useLocation()
  const kind = getDemoKind(id, location.pathname)
  const receipt = demoReceipts[kind]
  const isFail = receipt.verdict === "FAIL"
  const [copyLabel, setCopyLabel] = React.useState("Copy demo URL")

  React.useEffect(() => {
    const previousTitle = document.title
    document.title = `${receipt.verdict} demo receipt · ProofRunner`
    return () => {
      document.title = previousTitle
    }
  }, [receipt.verdict])

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopyLabel("Copied")
  }

  const downloadJson = () => {
    const payload = JSON.stringify({ demo: true, ...receipt }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `proofrunner-demo-${kind}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl animate-fade-in-up">
      <div className="mb-12 text-center">
        <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-amber-300">
          Demonstration data — not a signed production receipt
        </p>
        <h1 className="text-3xl font-bold text-white mb-4">
          Demo verification {isFail ? "failed" : "passed"}
        </h1>
        <p className="text-slate-400">{receipt.summary}</p>
      </div>

      <Card className={`relative overflow-hidden mb-8 border ${isFail ? "border-fail/30" : "border-pass/30"}`}>
        <div className={`absolute -top-24 -right-24 w-64 h-64 blur-[100px] rounded-full pointer-events-none ${isFail ? "bg-fail/20" : "bg-pass/20"}`} />
        <CardHeader className="border-b border-white/5 bg-black/20">
          <div className="flex items-center justify-between">
            <h2 className="tracking-wider uppercase text-sm font-semibold text-slate-400">Demo receipt</h2>
            <Badge variant={isFail ? "fail" : "pass"}>{receipt.verdict}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <dl className="divide-y divide-white/5 text-sm font-mono">
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Repository</dt><dd className="col-span-2 text-slate-300 break-all">{receipt.repository}</dd></div>
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Code commit</dt><dd className="col-span-2 text-slate-300 break-all">{receipt.commit}</dd></div>
            <div className="grid grid-cols-3 p-4"><dt className="text-slate-500">Verification skill</dt><dd className="col-span-2 text-slate-300">{receipt.skill}</dd></div>
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
