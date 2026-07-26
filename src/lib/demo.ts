export {
  DEMO_BROKEN_SHA,
  DEMO_BROKEN_TAG,
  DEMO_FIXED_SHA,
  DEMO_FIXED_TAG,
  DEMO_REPOSITORY_URL,
  demoReceipts,
  getDemoKind,
  getDemoProgressLabel,
  getDemoReceiptDisplayVerdict,
  getDemoReceiptOpenGraphMetadata,
  isDemoKind,
  isPinnedDemoReceipt,
} from "@ever-guild/proof-runner-metadata"
export { getDemoReceiptOpenGraphMetadata as getDemoOpenGraphMetadata } from "@ever-guild/proof-runner-metadata"
export type {
  DemoCheckOutcome,
  DemoDisplayVerdict,
  DemoKind,
  DemoOpenGraphMetadata,
  DemoReceipt,
  PinnedDemoReceipt,
  SimulatedDemoReceipt,
} from "@ever-guild/proof-runner-metadata"

export function isCanonicalGitHubRepository(value: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value)
}

export function isNonFailStatus(status: string, verdict: string | null): boolean {
  const isTimeout = status === "TIMEOUT"
  const isSystemError = status === "SYSTEM_ERROR"
  return verdict === "FAIL" && !isTimeout && !isSystemError
}
