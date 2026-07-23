import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { Separator } from "../components/ui/separator"
import { Shield, GitBranch } from "lucide-react"

export function Scene2Inspect({ onNext }: { onNext: () => void }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Repository Inspection</CardTitle>
          <Badge variant="pass">VERIFIED</Badge>
        </div>
        <CardDescription>
          ever-guild/proof-runner
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4 text-sm text-slate-300">
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-md border border-slate-800">
            <GitBranch className="w-4 h-4 text-slate-500" />
            main
          </div>
          <span className="text-slate-500 font-mono text-xs">Commit: a1b2c3d</span>
        </div>

        <Separator />

        <div className="space-y-4">
          <h4 className="text-sm font-medium text-slate-300 uppercase tracking-widest">Available Skills</h4>
          
          <div className="flex items-center justify-between p-4 rounded-lg border border-indigo-500/30 bg-indigo-500/10">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-indigo-400" />
              <div>
                <p className="text-sm font-medium text-slate-100">Lint & Test Proof</p>
                <p className="text-xs text-slate-400 mt-1">Runs ESLint and Vitest to prove codebase stability.</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={onNext}>Select</Button>
          </div>
          
        </div>
      </CardContent>
    </Card>
  )
}
