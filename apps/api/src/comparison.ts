import { createHash } from "node:crypto";
import {
  ComparisonEvidenceSelectorSchema,
  ComparisonRequestSchema,
  ComparisonResponseSchema,
  SignedReceiptSchema,
  VerificationContractSchema,
  canonicalize,
  type ComparisonEvidenceSelector,
  type ComparisonRequest,
  type ComparisonResponse,
  type NormalizedCheck,
  type SignedReceipt,
  type VerificationContract,
} from "@ever-guild/proof-runner-schema";
import type { StoredReceipt } from "@ever-guild/proof-runner-receipt";

export type ComparisonCompatibilityReason =
  | "REPOSITORY_MISMATCH"
  | "CONTRACT_MISMATCH"
  | "SKILL_MISMATCH"
  | "RUNTIME_MISMATCH";

export class ComparisonCompatibilityError extends Error {
  constructor(
    readonly reasonCodes: ComparisonCompatibilityReason[],
  ) {
    super("The selected receipts are not compatible for comparison.");
    this.name = "ComparisonCompatibilityError";
  }
}

export class ComparisonEvidenceNotFoundError extends Error {
  constructor(readonly selector: ComparisonEvidenceSelector) {
    super("The selected verified evidence was not found.");
    this.name = "ComparisonEvidenceNotFoundError";
  }
}

export class ComparisonInvalidSelectorError extends Error {
  constructor() {
    super("Comparison selectors must be run IDs or receipt hashes.");
    this.name = "ComparisonInvalidSelectorError";
  }
}

export interface ComparisonReceiptLookup {
  get(id: string): StoredReceipt | null;
  getByPayloadHash(payloadHash: string): StoredReceipt | null;
}

const contractCompatibilityProjection = (
  contract: VerificationContract | null,
) =>
  contract
    ? {
        version: contract.version,
        criteria: [...contract.criteria].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        prohibitions: [...contract.prohibitions].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      }
    : null;

const contractCompatibilityHash = (
  contract: VerificationContract | null,
): string | null => {
  const projection = contractCompatibilityProjection(contract);
  return projection
    ? createHash("sha256").update(canonicalize(projection)).digest("hex")
    : null;
};

const compatibilityReasons = (
  baseline: SignedReceipt,
  candidate: SignedReceipt,
  baselineContract: VerificationContract | null,
  candidateContract: VerificationContract | null,
): ComparisonCompatibilityReason[] => {
  const left = baseline.payload.report;
  const right = candidate.payload.report;
  const reasons: ComparisonCompatibilityReason[] = [];
  if (left.repositoryUrl !== right.repositoryUrl) {
    reasons.push("REPOSITORY_MISMATCH");
  }
  if (left.contractVersion !== right.contractVersion) {
    reasons.push("CONTRACT_MISMATCH");
  }
  if (
    canonicalize(contractCompatibilityProjection(baselineContract)) !==
    canonicalize(contractCompatibilityProjection(candidateContract))
  ) {
    reasons.push("CONTRACT_MISMATCH");
  }
  if (
    left.skill.name !== right.skill.name ||
    left.skill.version !== right.skill.version ||
    left.skill.hash !== right.skill.hash
  ) {
    reasons.push("SKILL_MISMATCH");
  }
  if (left.runtimeImageDigest !== right.runtimeImageDigest) {
    reasons.push("RUNTIME_MISMATCH");
  }
  return reasons;
};

const isNonPassing = (outcome: NormalizedCheck["outcome"]): boolean =>
  outcome === "FAILED" || outcome === "INCONCLUSIVE" || outcome === "SKIPPED";

const compareChecks = (
  baseline: SignedReceipt,
  candidate: SignedReceipt,
) => {
  const baselineChecks = new Map(
    baseline.payload.report.checks.map((check) => [check.id, check]),
  );
  const candidateChecks = new Map(
    candidate.payload.report.checks.map((check) => [check.id, check]),
  );
  const checkIds = [...new Set([
    ...baselineChecks.keys(),
    ...candidateChecks.keys(),
  ])].sort();

  return checkIds.map((checkId) => {
    const left = baselineChecks.get(checkId);
    const right = candidateChecks.get(checkId);
    if (!left) {
      return {
        checkId,
        classification: "ADDED" as const,
        baselineOutcome: null,
        candidateOutcome: right!.outcome,
      };
    }
    if (!right) {
      return {
        checkId,
        classification: "REMOVED" as const,
        baselineOutcome: left.outcome,
        candidateOutcome: null,
      };
    }

    const classification =
      isNonPassing(left.outcome) && !isNonPassing(right.outcome)
        ? "RESOLVED"
        : !isNonPassing(left.outcome) && isNonPassing(right.outcome)
          ? "NEW"
          : "UNCHANGED";
    return {
      checkId,
      classification,
      baselineOutcome: left.outcome,
      candidateOutcome: right.outcome,
    };
  });
};

const artifactProjection = (receipt: SignedReceipt) =>
  [...(receipt.payload.report.artifacts ?? [])]
    .map((artifact) => ({
      id: artifact.id,
      sha256: artifact.sha256,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

export const compareVerifiedReceipts = (input: {
  request: ComparisonRequest;
  baselineReceipt: SignedReceipt;
  candidateReceipt: SignedReceipt;
  baselineContract?: VerificationContract | null;
  candidateContract?: VerificationContract | null;
}): ComparisonResponse => {
  const request = ComparisonRequestSchema.parse(input.request);
  const baselineReceipt = SignedReceiptSchema.parse(input.baselineReceipt);
  const candidateReceipt = SignedReceiptSchema.parse(input.candidateReceipt);
  const baselineContract = input.baselineContract
    ? VerificationContractSchema.parse(input.baselineContract)
    : null;
  const candidateContract = input.candidateContract
    ? VerificationContractSchema.parse(input.candidateContract)
    : null;
  const reasons = compatibilityReasons(
    baselineReceipt,
    candidateReceipt,
    baselineContract,
    candidateContract,
  );
  if (reasons.length > 0) throw new ComparisonCompatibilityError(reasons);

  const baselineReport = baselineReceipt.payload.report;
  const candidateReport = candidateReceipt.payload.report;
  const checks = compareChecks(baselineReceipt, candidateReceipt);
  const driftLabels: Array<
    "VERDICT_DRIFT" |
    "CHECK_SET_DRIFT" |
    "CHECK_OUTCOME_DRIFT" |
    "ARTIFACT_DRIFT"
  > = [];
  if (baselineReport.verdict !== candidateReport.verdict) {
    driftLabels.push("VERDICT_DRIFT");
  }
  if (
    checks.some(
      (check) =>
        check.classification === "ADDED" ||
        check.classification === "REMOVED",
    )
  ) {
    driftLabels.push("CHECK_SET_DRIFT");
  }
  if (
    checks.some(
      (check) =>
        check.baselineOutcome !== null &&
        check.candidateOutcome !== null &&
        check.baselineOutcome !== check.candidateOutcome,
    )
  ) {
    driftLabels.push("CHECK_OUTCOME_DRIFT");
  }
  if (
    canonicalize(artifactProjection(baselineReceipt)) !==
    canonicalize(artifactProjection(candidateReceipt))
  ) {
    driftLabels.push("ARTIFACT_DRIFT");
  }

  const baselineValue = request.baseline.value;
  const candidateValue = request.candidate.value;
  const comparisonId = createHash("sha256")
    .update(
      canonicalize({
        baselineReceiptHash: baselineReceipt.payloadHash,
        candidateReceiptHash: candidateReceipt.payloadHash,
      }),
    )
    .digest("hex");
  return ComparisonResponseSchema.parse({
    contractVersion: baselineReport.contractVersion,
    id: comparisonId,
    baseline: {
      selector: request.baseline,
      runId: baselineReport.runId,
      receiptHash: baselineReceipt.payloadHash,
      commitSha: baselineReport.resolvedCommitSha,
      verdict: baselineReport.verdict,
      receipt: baselineReceipt,
    },
    candidate: {
      selector: request.candidate,
      runId: candidateReport.runId,
      receiptHash: candidateReceipt.payloadHash,
      commitSha: candidateReport.resolvedCommitSha,
      verdict: candidateReport.verdict,
      receipt: candidateReceipt,
    },
    compatibility: {
      repositoryUrl: baselineReport.repositoryUrl,
      contractVersion: baselineReport.contractVersion,
      skill: baselineReport.skill,
      runtimeImageDigest: baselineReport.runtimeImageDigest,
      verificationContractHash:
        contractCompatibilityHash(baselineContract),
    },
    checks,
    driftLabels,
    links: {
      self: `/api/comparisons/${encodeURIComponent(baselineValue)}/${encodeURIComponent(candidateValue)}`,
      ui: `/compare/${encodeURIComponent(baselineValue)}/${encodeURIComponent(candidateValue)}`,
    },
  });
};

export const comparisonSelectorFromPath = (
  value: string,
): ComparisonEvidenceSelector => {
  for (const type of ["run-id", "receipt-hash"] as const) {
    const parsed = ComparisonEvidenceSelectorSchema.safeParse({
      type,
      value,
    });
    if (parsed.success) return parsed.data;
  }
  throw new ComparisonInvalidSelectorError();
};

export class ComparisonService {
  constructor(
    private readonly receipts: ComparisonReceiptLookup,
    private readonly verificationContractForRun: (
      runId: string,
    ) => VerificationContract | null = () => null,
  ) {}

  compare(candidate: ComparisonRequest): ComparisonResponse {
    const request = ComparisonRequestSchema.parse(candidate);
    const baselineReceipt = this.resolve(request.baseline);
    const candidateReceipt = this.resolve(request.candidate);
    return compareVerifiedReceipts({
      request,
      baselineReceipt,
      candidateReceipt,
      baselineContract: this.verificationContractForRun(
        baselineReceipt.payload.report.runId,
      ),
      candidateContract: this.verificationContractForRun(
        candidateReceipt.payload.report.runId,
      ),
    });
  }

  comparePath(baseline: string, candidate: string): ComparisonResponse {
    return this.compare({
      contractVersion: "1.0",
      baseline: comparisonSelectorFromPath(baseline),
      candidate: comparisonSelectorFromPath(candidate),
    });
  }

  private resolve(selector: ComparisonEvidenceSelector): SignedReceipt {
    const stored =
      selector.type === "run-id"
        ? this.receipts.get(selector.value)
        : this.receipts.getByPayloadHash(selector.value);
    if (!stored) throw new ComparisonEvidenceNotFoundError(selector);
    return stored.receipt;
  }
}
