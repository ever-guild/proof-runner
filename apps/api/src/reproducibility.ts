import { createHash } from "node:crypto";
import {
  CONTRACT_VERSION,
  canonicalize,
  ReproducibilityComparisonSchema,
  ReproducibilityProjectionSchema,
  ReproducibilityResponseSchema,
  type ReproducibilityProjection,
  type ReproducibilityResponse,
  type VerificationReport,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import {
  RunStore,
  type StoredReproducibility,
  type StoredRun,
} from "./store.js";

const byId = <T extends { id: string }>(left: T, right: T): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

/**
 * Produces the semantic comparison surface. Per-run identity and timing are
 * intentionally absent, and unordered evidence is normalized by stable ID.
 */
export const projectReproducibilityReport = (
  report: VerificationReport,
): ReproducibilityProjection =>
  ReproducibilityProjectionSchema.parse({
    runtimeImageDigest: report.runtimeImageDigest,
    verdict: report.verdict,
    reasonCode: report.reasonCode,
    checks: report.checks
      .map((check) => ({ id: check.id, outcome: check.outcome }))
      .sort(byId),
    artifacts: [...(report.artifacts ?? [])]
      .map((artifact) => ({ id: artifact.id, sha256: artifact.sha256 }))
      .sort(byId),
  });

const projectionHash = (projection: ReproducibilityProjection): string =>
  createHash("sha256").update(canonicalize(projection)).digest("hex");

export const compareReproducibilityReports = (
  baselineReport: VerificationReport,
  candidateReport: VerificationReport,
) => {
  const baseline = projectReproducibilityReport(baselineReport);
  const candidate = projectReproducibilityReport(candidateReport);
  const baselineHash = projectionHash(baseline);
  const candidateHash = projectionHash(candidate);
  return ReproducibilityComparisonSchema.parse({
    consistent: baselineHash === candidateHash,
    baseline,
    candidate,
    baselineHash,
    candidateHash,
  });
};

const childResponse = (child: StoredRun) => ({
  runId: child.response.id,
  status: child.response.status,
  verdict: child.response.verdict,
  receipt: child.response.links.receipt,
});

/**
 * Turns the two durable child runs into one unsigned reproducibility result.
 * Signed child receipts remain the evidence authority; this projection only
 * compares their stable semantic fields.
 */
export class ReproducibilityService {
  constructor(private readonly store: RunStore) {}

  create(idempotencyKey: string, request: VerifyRequest) {
    const created = this.store.createReproducibility(idempotencyKey, request);
    if (created.kind === "conflict" || created.kind === "full") return created;
    return {
      kind: created.kind,
      reproducibility: this.responseFor(created.reproducibility),
    };
  }

  get(id: string): ReproducibilityResponse | null {
    const stored = this.store.getReproducibility(id);
    return stored ? this.responseFor(stored) : null;
  }

  private responseFor(
    stored: StoredReproducibility,
  ): ReproducibilityResponse {
    const children = stored.children.map(childResponse) as [
      ReturnType<typeof childResponse>,
      ReturnType<typeof childResponse>,
    ];
    const base = {
      contractVersion: CONTRACT_VERSION,
      id: stored.id,
      createdAt: stored.createdAt,
      children,
      links: { self: `/api/reproducibility/${stored.id}` },
    };
    const pending = stored.children.some((child) =>
      ["QUEUED", "RUNNING"].includes(child.response.status),
    );
    if (pending) {
      return ReproducibilityResponseSchema.parse({
        ...base,
        status: stored.children.every(
          (child) => child.response.status === "QUEUED",
        )
          ? "QUEUED"
          : "RUNNING",
        verdict: null,
        reasonCode: null,
        comparison: null,
      });
    }

    const [baseline, candidate] = stored.children;
    if (!baseline.response.report || !candidate.response.report) {
      return ReproducibilityResponseSchema.parse({
        ...base,
        status: "INCONCLUSIVE",
        verdict: "INCONCLUSIVE",
        reasonCode: "CHILD_RUN_UNAVAILABLE",
        comparison: null,
      });
    }

    const comparison = compareReproducibilityReports(
      baseline.response.report,
      candidate.response.report,
    );
    if (!comparison.consistent) {
      return ReproducibilityResponseSchema.parse({
        ...base,
        status: "INCONCLUSIVE",
        verdict: "INCONCLUSIVE",
        reasonCode: "NONDETERMINISTIC_RESULT",
        comparison,
      });
    }

    return ReproducibilityResponseSchema.parse({
      ...base,
      status: "COMPLETED",
      verdict: baseline.response.report.verdict,
      reasonCode: baseline.response.report.reasonCode,
      comparison: { ...comparison, consistent: true },
    });
  }
}
