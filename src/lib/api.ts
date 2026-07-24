export type RepositoryRef = { type: "branch" | "tag" | "commit"; value: string }

export type Inspection = {
  repositoryUrl: string
  requestedRef: RepositoryRef
  resolvedCommitSha: string
  packageManager: "npm" | "pnpm"
  lockfile: "package-lock.json" | "pnpm-lock.yaml"
  nodeVersion: string | null
  hasTypeScript: boolean
  scripts: { build: string | null; test: string | null }
  selectedSkill: "node-typescript@1"
  selectedSkillHash: string
}

export type InspectResult =
  | { contractVersion: "1.0"; supported: true; inspection: Inspection }
  | { contractVersion: "1.0"; supported: false; reason: string; message: string }

export type Check = {
  id: string
  stage: string
  title: string
  outcome: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "SKIPPED" | "INCONCLUSIVE"
  durationMs: number | null
  exitCode: number | null
  summary: string
}

export type Run = {
  id: string
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "TIMEOUT" | "SYSTEM_ERROR"
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE" | null
  activeStage: string | null
  queuePosition: number | null
  startedAt: string | null
  completedAt: string | null
  links: { self: string; receipt: string | null }
  report: { checks: Check[]; durationMs: number; reasonCode: string | null; runtimeImageDigest: string } | null
  systemError: { code: string; message: string; retryable: boolean } | null
}

const json = async <T>(response: Response): Promise<T> => {
  const body = await response.json() as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed with HTTP ${response.status}`)
  return body
}

export const inspectRepository = async (repositoryUrl: string, ref: RepositoryRef): Promise<InspectResult> =>
  json(await fetch("/api/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contractVersion: "1.0", repositoryUrl, ref }),
  }))

export const startVerification = async (inspection: Inspection): Promise<Run> => {
  const response = await json<{ run: Run }>(await fetch("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      contractVersion: "1.0",
      repositoryUrl: inspection.repositoryUrl,
      resolvedCommitSha: inspection.resolvedCommitSha,
      resolvedRef: inspection.requestedRef,
      skill: { name: "node-typescript", version: "1", hash: inspection.selectedSkillHash },
      public: true,
    }),
  }))
  return response.run
}

export const getRun = async (id: string): Promise<Run> => json(await fetch(`/api/runs/${encodeURIComponent(id)}`))

export const getReceipt = async (id: string): Promise<unknown> => json(await fetch(`/api/receipts/${encodeURIComponent(id)}`))
