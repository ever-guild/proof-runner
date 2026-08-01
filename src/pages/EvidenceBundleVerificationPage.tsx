import * as React from "react"
import { AlertCircle, CheckCircle2, FileCheck2, Loader2 } from "lucide-react"
import { Link } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import {
  verifyEvidenceBundleArchive,
  type EvidenceBundleVerification,
} from "../lib/api"

const MAX_ARCHIVE_BYTES = 4 * 1_048_576

export const evidenceBundleFailureMessage = (
  reason: EvidenceBundleVerification["reason"],
): string => {
  const messages: Record<
    Exclude<EvidenceBundleVerification["reason"], null>,
    string
  > = {
    INVALID_ARCHIVE: "The file is not a canonical ProofRunner ZIP archive.",
    ARCHIVE_LIMIT_EXCEEDED: "The archive exceeds a bounded verification limit.",
    UNSAFE_ARCHIVE_PATH: "The archive contains an unsafe entry path.",
    DUPLICATE_ARCHIVE_PATH: "The archive contains duplicate entry paths.",
    MANIFEST_INVALID: "The signed manifest is malformed or non-canonical.",
    MANIFEST_COVERAGE_MISMATCH:
      "The manifest does not cover the archive exactly.",
    CHECKSUM_MISMATCH: "A payload or checksum entry was modified.",
    UNKNOWN_KEY: "The receipt signing key is not available.",
    INVALID_MANIFEST_SIGNATURE: "The manifest signature is invalid.",
    INVALID_RECEIPT: "The signed receipt is invalid.",
    RECEIPT_REPORT_MISMATCH:
      "The report does not match the signed receipt.",
    CONTRACT_MISMATCH:
      "The verification contract does not match the signed receipt.",
  }
  return reason ? messages[reason] : "The evidence bundle is invalid."
}

export type EvidenceBundleVerificationState = {
  archive: File | null
  result: EvidenceBundleVerification | null
  error: string
  verifying: boolean
  generation: number
}

export type EvidenceBundleVerificationAction =
  | { type: "SELECT_ARCHIVE"; archive: File | null }
  | { type: "START_VERIFICATION"; generation: number }
  | {
      type: "VERIFICATION_SUCCESS"
      generation: number
      result: EvidenceBundleVerification
    }
  | { type: "VERIFICATION_ERROR"; generation: number; error: string }
  | { type: "SET_ERROR"; error: string }

export const initialVerificationState: EvidenceBundleVerificationState = {
  archive: null,
  result: null,
  error: "",
  verifying: false,
  generation: 0,
}

export function verificationReducer(
  state: EvidenceBundleVerificationState,
  action: EvidenceBundleVerificationAction,
): EvidenceBundleVerificationState {
  switch (action.type) {
    case "SELECT_ARCHIVE":
      return {
        ...state,
        archive: action.archive,
        result: null,
        error: "",
        verifying: false,
        generation: state.generation + 1,
      }
    case "START_VERIFICATION":
      return {
        ...state,
        result: null,
        error: "",
        verifying: true,
        generation: action.generation,
      }
    case "VERIFICATION_SUCCESS":
      if (action.generation !== state.generation) {
        return state
      }
      return {
        ...state,
        result: action.result,
        verifying: false,
      }
    case "VERIFICATION_ERROR":
      if (action.generation !== state.generation) {
        return state
      }
      return {
        ...state,
        error: action.error,
        verifying: false,
      }
    case "SET_ERROR":
      return {
        ...state,
        error: action.error,
        verifying: false,
      }
    default:
      return state
  }
}

export function EvidenceBundleVerificationPage() {
  const [state, dispatch] = React.useReducer(
    verificationReducer,
    initialVerificationState,
  )
  const generationRef = React.useRef(state.generation)
  generationRef.current = state.generation

  const verifyArchive = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!state.archive) {
      dispatch({
        type: "SET_ERROR",
        error: "Choose an evidence bundle ZIP first.",
      })
      return
    }
    if (state.archive.size > MAX_ARCHIVE_BYTES) {
      dispatch({
        type: "SET_ERROR",
        error: "The archive exceeds the 4 MiB verification limit.",
      })
      return
    }
    const nextGen = generationRef.current + 1
    const targetArchive = state.archive
    dispatch({ type: "START_VERIFICATION", generation: nextGen })

    try {
      const res = await verifyEvidenceBundleArchive(targetArchive)
      dispatch({
        type: "VERIFICATION_SUCCESS",
        generation: nextGen,
        result: res,
      })
    } catch (requestError) {
      dispatch({
        type: "VERIFICATION_ERROR",
        generation: nextGen,
        error:
          requestError instanceof Error
            ? requestError.message
            : "The archive could not be verified.",
      })
    }
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16 animate-fade-in-up">
      <div className="mb-8 text-center">
        <p className="mb-3 text-xs font-mono font-semibold uppercase tracking-widest text-indigo-300">
          Offline evidence check
        </p>
        <h1 className="mb-3 text-3xl font-bold text-white">
          Verify an evidence bundle
        </h1>
        <p className="text-slate-400">
          Upload a downloaded ZIP. Verification checks its bounded layout,
          checksums, manifest and receipt signatures without contacting the
          source repository or another external service.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="border-b border-white/5 bg-black/20">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Evidence archive
          </h2>
        </CardHeader>
        <CardContent>
          <form className="space-y-5 p-4" onSubmit={(event) => void verifyArchive(event)}>
            <label className="block text-sm font-medium text-slate-200">
              ProofRunner ZIP, up to 4 MiB
              <input
                className="mt-2 block w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-200 file:mr-4 file:rounded file:border-0 file:bg-indigo-500/20 file:px-3 file:py-2 file:text-indigo-200"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  dispatch({
                    type: "SELECT_ARCHIVE",
                    archive: event.target.files?.[0] ?? null,
                  })
                }}
              />
            </label>
            <Button type="submit" disabled={state.verifying} className="gap-2">
              {state.verifying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileCheck2 className="h-4 w-4" />
              )}
              {state.verifying ? "Verifying…" : "Verify evidence"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Verification unavailable</AlertTitle>
          <AlertDescription className="break-all">{state.error}</AlertDescription>
        </Alert>
      )}

      {state.result?.valid && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Evidence bundle is valid</AlertTitle>
          <AlertDescription className="break-all">
            Manifest and receipt signatures are valid. Bundle ID:{" "}
            <span className="font-mono">{state.result.bundleId}</span>
          </AlertDescription>
        </Alert>
      )}

      {state.result && !state.result.valid && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Evidence bundle is invalid</AlertTitle>
          <AlertDescription>
            {evidenceBundleFailureMessage(state.result.reason)}
            {state.result.reason && (
              <span className="mt-2 block font-mono text-xs">
                {state.result.reason}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-8 text-center">
        <Button asChild variant="ghost">
          <Link to="/">Back to verification</Link>
        </Button>
      </div>
    </div>
  )
}
