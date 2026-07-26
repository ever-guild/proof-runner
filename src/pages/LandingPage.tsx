import * as React from "react"
import { Lock, Bot } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "../components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Select } from "../components/ui/select"
import { Badge } from "../components/ui/badge"
import { isCanonicalGitHubRepository } from "../lib/demo"
import { inspectRepository, startVerification, type Inspection } from "../lib/api"

export function LandingPage() {
  const navigate = useNavigate()
  const [repositoryUrl, setRepositoryUrl] = React.useState("https://github.com/ever-guild/proof-runner")
  const [gitRef, setGitRef] = React.useState("main")
  const [gitRefType, setGitRefType] = React.useState<"branch" | "tag" | "commit">("branch")
  const [inspectState, setInspectState] = React.useState<"idle" | "loading" | "supported" | "unsupported">("idle")
  const [inspection, setInspection] = React.useState<Inspection | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState("")

  const handleInspect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isCanonicalGitHubRepository(repositoryUrl)) {
      setError("Use a canonical https://github.com/owner/repository URL.")
      setInspectState("idle")
      return
    }
    if (!gitRef.trim()) {
      setError("Enter a branch, tag, or commit SHA.")
      setInspectState("idle")
      return
    }
    setError("")
    setInspection(null)
    setInspectState("loading")
    try {
      const result = await inspectRepository(repositoryUrl, { type: gitRefType, value: gitRef.trim() })
      if (!result.supported) {
        setError(`${result.reason}: ${result.message}`)
        setInspectState("unsupported")
        return
      }
      setInspection(result.inspection)
      setInspectState("supported")
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Inspection could not be completed.")
      setInspectState("unsupported")
    }
  }

  const handleVerify = async () => {
    if (!inspection) return
    setSubmitting(true)
    setError("")
    try {
      navigate(`/runs/${(await startVerification(inspection)).id}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Verification could not be started.")
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full min-h-screen flex flex-col justify-center pt-16 pb-20 px-4 text-center">
        <div className="container mx-auto max-w-4xl">
          <p className="text-indigo-300 font-mono tracking-widest uppercase text-xs mb-6 font-semibold inline-block">
            Independent software verification for AI agents
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Agent-built software,<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-emerald-300">independently verified.</span>
          </h1>
          <p className="text-xl text-white font-semibold tracking-wide uppercase mb-4">Run it. Prove it.</p>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            ProofRunner is designed to verify an exact Git commit in an isolated environment using a pinned verification skill. Public execution and signed receipts remain unavailable until deployment; the linked example is synthetic demo data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild variant="primary" size="lg" className="w-full sm:w-auto font-semibold"><a href="#verify">Verify a repository</a></Button>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto font-semibold"><Link to="/examples/passed">View synthetic demo</Link></Button>
          </div>
          <p className="mt-6 text-sm text-slate-300 font-medium">
            <a href="/skill.md" className="hover:text-indigo-300 transition-colors">Using an AI agent? Get the skill file →</a>
          </p>

          {/* Trust strip */}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 mt-20 text-xs font-mono uppercase tracking-wider text-slate-400 font-medium">
            <span className="text-slate-300">Public Git commits</span>
            <span>•</span>
            <span className="text-slate-300">Pinned verification skills</span>
            <span>•</span>
            <span className="text-slate-300">Isolated execution</span>
            <span>•</span>
            <span className="text-slate-300">Machine-readable receipts</span>
          </div>
        </div>
      </section>

      {/* Interactive Verification Form */}
      <section id="verify" className="w-full py-24 px-4 relative scroll-mt-20 flex justify-center">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-3xl relative z-10">
          <Card className="p-6 md:p-8 border-white/20 bg-black/40 backdrop-blur-md shadow-2xl">
            <CardHeader className="pb-8">
              <h2 className="text-white text-3xl font-bold">Verify Repository</h2>
              <CardDescription className="text-slate-300 text-base mt-2">Enter a public GitHub repository to start inspection.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-8" onSubmit={handleInspect} noValidate>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="repository-url" className="text-base font-semibold text-slate-200">Repository URL</label>
                  <Input id="repository-url" name="repositoryUrl" type="url" required aria-describedby={error ? "repository-error" : undefined} aria-invalid={Boolean(error)} placeholder="https://github.com/owner/repository" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} className="h-14 text-base px-5" />
                  {error && <p id="repository-error" role="alert" className="text-sm text-fail mt-1">{error}</p>}
                </div>
                <div className="space-y-2">
                  <label htmlFor="git-ref" className="text-base font-semibold text-slate-200">Git reference</label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[11rem_1fr]">
                    <div>
                      <label htmlFor="git-ref-type" className="sr-only">Git reference type</label>
                      <Select
                        id="git-ref-type"
                        name="gitRefType"
                        ariaLabel="Git reference type"
                        value={gitRefType}
                        onValueChange={(val) => setGitRefType(val as "branch" | "tag" | "commit")}
                        options={[
                          { value: "branch", label: "Branch" },
                          { value: "tag", label: "Tag" },
                          { value: "commit", label: "Commit SHA" },
                        ]}
                        className="h-14 text-base"
                      />
                    </div>
                    <div>
                      <label htmlFor="git-ref" className="sr-only">Git reference value</label>
                      <Input id="git-ref" name="gitRef" required placeholder={gitRefType === "commit" ? "Full commit SHA" : `Enter ${gitRefType} name`} value={gitRef} onChange={(event) => setGitRef(event.target.value)} className="h-14 text-base px-5" />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="verification-profile" className="text-base font-semibold text-slate-200">Verification profile</label>
                  <Input id="verification-profile" readOnly value="Auto-detect (Node.js / TypeScript)" className="h-14 text-base px-5 text-slate-400 bg-white/5 border-dashed" />
                </div>
              </div>

              {(inspectState === "idle" || inspectState === "unsupported") && (
                <Button type="submit" variant="primary" size="lg" className="w-full h-14 text-lg font-bold tracking-wide mt-4">
                  Inspect repository
                </Button>
              )}

              {inspectState === "loading" && <Button type="button" disabled variant="primary" size="lg" className="w-full h-14 text-lg font-bold tracking-wide mt-4">Inspecting immutable commit…</Button>}

              {inspectState === "supported" && inspection && (
                <div className="space-y-6 animate-fade-in-up">
                  <div className="p-4 rounded-xl bg-white/10 border border-white/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">Repository inspection</span>
                      <Badge variant="queued">SUPPORTED</Badge>
                    </div>
                    <p className="text-xs text-slate-400 break-all">{inspection.repositoryUrl} · {inspection.resolvedCommitSha}</p>
                    <div className="grid grid-cols-2 gap-4 text-sm mt-4">
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Stack</p>
                        <p className="text-slate-200 font-mono text-xs">{inspection.hasTypeScript ? "TypeScript" : "JavaScript"}, {inspection.packageManager}, Node {inspection.nodeVersion ?? "unspecified"}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Skill</p>
                        <p className="text-slate-200 font-mono text-xs">{inspection.selectedSkill}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Duration</p>
                        <p className="text-slate-200 font-mono text-xs">Measured after verification</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Price</p>
                        <p className="text-slate-200 font-mono text-xs">Free launch mode</p>
                      </div>
                    </div>
                  </div>
                  <Button type="button" disabled={submitting} onClick={() => void handleVerify()} variant="primary" className="w-full font-semibold">
                    {submitting ? "Starting verification…" : "Verify this immutable commit"}
                  </Button>
                </div>
              )}
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="w-full py-24 px-4 bg-black/40 border-y border-white/10">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold text-center mb-16 text-white">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-bold text-xl">I</div>
              <h3 className="text-xl font-bold text-slate-100">Pin the delivery</h3>
              <p className="text-slate-300 text-sm leading-relaxed">Submit a public Git repository and a branch, tag or commit. ProofRunner resolves it to one exact immutable commit.</p>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-bold text-xl">II</div>
              <h3 className="text-xl font-bold text-slate-100">Execute the proof</h3>
              <p className="text-slate-300 text-sm leading-relaxed">A versioned verification skill runs install, build and tests inside an isolated, resource-limited environment.</p>
            </div>
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-bold text-xl">III</div>
              <h3 className="text-xl font-bold text-slate-100">Receive the receipt</h3>
              <p className="text-slate-300 text-sm leading-relaxed">Get a structured PASS, FAIL or INCONCLUSIVE report tied to the code commit, skill version and runtime.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why not CI */}
      <section className="w-full py-24 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white leading-tight">
            CI tells the author what happened.<br/>
            <span className="text-indigo-300">ProofRunner proves it to the buyer.</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-16 text-left">
            <Card className="border-slate-700 bg-black/20 shadow-none">
              <CardHeader><CardTitle className="text-slate-300 text-lg font-bold">Regular CI</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-400">
                <p>• Belongs to repository owner</p>
                <p>• Config can change with code</p>
                <p>• Result tied to user account</p>
                <p>• For dev teams</p>
              </CardContent>
            </Card>
            <Card className="border-indigo-400/40 bg-indigo-500/10">
              <CardHeader><CardTitle className="text-indigo-300 text-lg font-bold">ProofRunner</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-200">
                <p>• Triggered by external buyer or agent</p>
                <p>• Skill is pinned by immutable hash</p>
                <p>• Receipt is public and portable</p>
                <p>• For accepting delivery</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* For agents */}
      <section id="for-agents" className="w-full py-24 px-4 bg-gradient-to-b from-transparent to-indigo-950/40 border-t border-white/10">
        <div className="container mx-auto max-w-5xl flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 space-y-6">
            <Badge variant="queued" showIcon={false} className="mb-2 border-white/20 text-slate-300"><Bot className="w-3 h-3 mr-2 inline text-indigo-400" /> A2MCP</Badge>
            <h2 className="text-3xl font-bold text-white">Built for agents, not just browsers</h2>
            <p className="text-slate-300 leading-relaxed">The frozen A2MCP contract defines how agents will inspect a repository, start a run, poll normalized status, and consume a receipt as structured JSON once the public service is live. Public OKX.AI availability and paid x402 mode are not claimed until their separate gates are complete.</p>
            <div className="flex gap-4 pt-4">
              <Button asChild variant="secondary" className="font-semibold text-white border-white/20"><a href="/skill.md">Open skill.md</a></Button>
              <Button asChild variant="ghost" className="font-semibold text-slate-300"><a href="/llms.txt">Open llms.txt</a></Button>
            </div>
          </div>
          <div className="flex-1 w-full">
            <div className="rounded-xl border border-white/20 bg-black/90 p-6 font-mono text-sm leading-relaxed text-slate-300 shadow-glass">
              <span className="text-indigo-400 font-bold">Fetch</span> <span className="text-white">/skill.md</span><br/>
              <span className="text-indigo-400 font-bold">and use</span> ProofRunner to verify the specified public Git repository and commit.<br/><br/>
              <span className="text-indigo-400 font-bold">Return</span> the verdict, failed checks, evidence, and public receipt URL.
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="w-full py-24 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <Lock className="w-12 h-12 text-slate-400 mx-auto mb-6" />
          <h2 className="text-3xl font-bold mb-6 text-white">Security & Limitations</h2>
          <p className="text-slate-300 mb-12 max-w-2xl mx-auto leading-relaxed">ProofRunner verifies the checks listed in the receipt. It is not a complete security audit, formal proof, or guarantee that the software is free of defects.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-6 gap-x-8 text-sm text-slate-200 font-mono text-left max-w-3xl mx-auto">
            <p className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Public repositories only</p>
            <p className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Pinned Git commit</p>
            <p className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Pinned verification skill</p>
            <p className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> Non-root execution</p>
            <p className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> CPU & memory limits</p>
            <p className="flex items-center gap-2"><span className="text-emerald-400 font-bold">✓</span> No prod credentials</p>
          </div>
        </div>
      </section>

    </div>
  )
}
