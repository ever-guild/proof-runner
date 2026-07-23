import * as React from "react"
import { Shield, GitBranch, ArrowRight, TerminalSquare, Lock, Activity, Bot } from "lucide-react"
import { Button } from "../components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Badge } from "../components/ui/badge"

export function LandingPage() {
  const [inspectState, setInspectState] = React.useState<"idle" | "inspecting" | "supported">("idle")

  const handleInspect = () => {
    setInspectState("inspecting")
    setTimeout(() => setInspectState("supported"), 1500)
  }

  return (
    <div className="flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full pt-32 pb-20 px-4 text-center">
        <div className="container mx-auto max-w-4xl">
          <p className="text-indigo-300 font-mono tracking-widest uppercase text-xs mb-6 font-semibold inline-block">
            Independent software verification for AI agents
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-8">
            Agent-built software,<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-emerald-300">independently verified.</span>
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            ProofRunner executes an exact Git commit in an isolated environment using a pinned verification skill and returns a reproducible PASS / FAIL receipt.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="primary" size="lg" className="w-full sm:w-auto font-semibold">Verify a repository</Button>
            <Button variant="secondary" size="lg" className="w-full sm:w-auto font-semibold">View a real receipt</Button>
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
      <section className="w-full py-20 px-4 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-2xl relative z-10">
          <Card className="p-2 border-white/20">
            <CardHeader>
              <CardTitle className="text-white text-xl">Verify Repository</CardTitle>
              <CardDescription className="text-slate-300 text-sm">Enter a public GitHub repository to start inspection.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-200">Repository URL</label>
                  <Input placeholder="https://github.com/owner/repository" defaultValue="https://github.com/ever-guild/proof-runner" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-200">Git reference</label>
                  <Input placeholder="Branch, tag or commit SHA" defaultValue="HEAD" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-200">Verification profile</label>
                  <Input readOnly value="Auto-detect (Node.js / TypeScript)" className="text-slate-400 bg-white/5" />
                </div>
              </div>

              {inspectState === "idle" && (
                <Button variant="primary" className="w-full font-semibold" onClick={handleInspect}>
                  Inspect repository — free
                </Button>
              )}

              {inspectState === "inspecting" && (
                <Button variant="secondary" className="w-full text-slate-200 font-semibold" disabled>
                  <Activity className="w-4 h-4 mr-2 animate-spin text-indigo-400" />
                  Analyzing repository...
                </Button>
              )}

              {inspectState === "supported" && (
                <div className="space-y-6 animate-fade-in-up">
                  <div className="p-4 rounded-xl bg-white/10 border border-white/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">Repository supported</span>
                      <Badge variant="pass">VERIFIED</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm mt-4">
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Stack</p>
                        <p className="text-slate-200 font-mono text-xs">Node.js 22, pnpm, Vitest</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Skill</p>
                        <p className="text-slate-200 font-mono text-xs">node-typescript-acceptance@0.1.0</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Duration</p>
                        <p className="text-slate-200 font-mono text-xs">40–90 seconds</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1 text-xs uppercase tracking-wider font-semibold">Price</p>
                        <p className="text-emerald-400 font-mono text-xs font-bold drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]">0.01 USD₮</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <Button variant="primary" className="flex-1 font-semibold" onClick={() => window.location.href='/runs/demo-123'}>
                      Run verification
                    </Button>
                    <Button variant="secondary" className="flex-1 font-semibold text-slate-200" onClick={() => window.location.href='/runs/fail-demo'}>
                      or run broken demo
                    </Button>
                  </div>
                </div>
              )}
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
            <p className="text-slate-300 leading-relaxed">ProofRunner is available as an A2MCP service on OKX.AI. Agents can inspect a repository, pay per verification through x402, start a run and consume the result as structured JSON.</p>
            <div className="flex gap-4 pt-4">
              <Button variant="secondary" className="font-semibold text-white border-white/20" onClick={() => window.open('/skill.md')}>Open skill.md</Button>
              <Button variant="ghost" className="font-semibold text-slate-300">View on OKX.AI</Button>
            </div>
          </div>
          <div className="flex-1 w-full">
            <div className="rounded-xl border border-white/20 bg-black/90 p-6 font-mono text-sm leading-relaxed text-slate-300 shadow-glass">
              <span className="text-indigo-400 font-bold">Fetch</span> <span className="text-white">https://proof.ever-guild.net/skill.md</span><br/>
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
