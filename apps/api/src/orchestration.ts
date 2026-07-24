import { createHash, randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION,
  canonicalize,
  INTERNAL_RUNNER_ROUTES,
  InternalCancellationResponseSchema,
  InternalDispatchResponseSchema,
  type InternalDispatchRequest,
  type InternalResultDeliveryRequest,
  type NormalizedCheck,
  type SignedReceipt,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import { RunStore } from "./store.js";

export interface RunnerClient {
  dispatch(request: InternalDispatchRequest): Promise<void>;
  cancel(runId: string): Promise<void>;
}

export interface ReceiptIssuer {
  issue(report: VerificationReport): SignedReceipt;
}

export type ResultDeliveryOutcome =
  | "ACCEPTED"
  | "LEASE_EXPIRED"
  | "RESULT_CONFLICT"
  | "RUN_NOT_FOUND";

export type HeartbeatOutcome =
  | { kind: "ACCEPTED"; leaseExpiresAt: string }
  | { kind: "LEASE_EXPIRED" }
  | { kind: "RUN_NOT_FOUND" };

type ActiveRun = {
  id: string;
  leaseId: string;
  expiresAt: number;
};

export class HttpRunnerClient implements RunnerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly bearerToken: string,
  ) {}

  async dispatch(request: InternalDispatchRequest): Promise<void> {
    const response = await this.send(
      INTERNAL_RUNNER_ROUTES.dispatch.path,
      "POST",
      request,
    );
    InternalDispatchResponseSchema.parse(await response.json());
  }

  async cancel(runId: string): Promise<void> {
    const response = await this.send(
      `/internal/v1/runs/${encodeURIComponent(runId)}/cancel`,
      "POST",
      {
        contractVersion: CONTRACT_VERSION,
        reason: "LEASE_EXPIRED",
        requestedAt: new Date().toISOString(),
      },
    );
    InternalCancellationResponseSchema.parse(await response.json());
  }

  private async send(
    path: string,
    method: "POST",
    body: unknown,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.bearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("RUNNER_UNAVAILABLE");
    return response;
  }
}

/**
 * Owns the active lease and exposes one operation for each transition that
 * crosses the API↔runner seam. SQLite remains the durable state authority.
 */
export class Orchestrator {
  private active: ActiveRun | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private dispatchBlockedUntil = 0;

  constructor(
    private readonly store: RunStore,
    private readonly runner: RunnerClient,
    private readonly receipts: ReceiptIssuer,
    private readonly leaseDurationMs = 30_000,
  ) {}

  start(): void {
    const interrupted = this.store.recoverInterruptedRuns();
    this.timer = setInterval(() => {
      void this.expireLease();
    }, Math.min(1_000, Math.max(100, Math.floor(this.leaseDurationMs / 2))));
    this.timer.unref();
    if (interrupted.length === 0) {
      void this.dispatchNext();
      return;
    }
    for (const runId of interrupted) {
      void this.runner.cancel(runId).catch(() => undefined);
    }
    this.deferDispatch(this.leaseDurationMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
    this.timer = null;
    this.dispatchTimer = null;
    this.dispatchBlockedUntil = 0;
  }

  async dispatchNext(): Promise<void> {
    if (this.active || Date.now() < this.dispatchBlockedUntil) return;

    const run = this.store.claimNext();
    if (!run) return;

    const leaseId = randomUUID();
    const expiresAt = Date.now() + this.leaseDurationMs;
    this.active = { id: run.response.id, leaseId, expiresAt };

    try {
      await this.runner.dispatch({
        contractVersion: CONTRACT_VERSION,
        runId: run.response.id,
        lease: {
          leaseId,
          leaseExpiresAt: new Date(expiresAt).toISOString(),
        },
        request: run.request,
      });
    } catch {
      const activeLease = this.active;
      const quarantineExpiresAt =
        activeLease?.id === run.response.id && activeLease.leaseId === leaseId
          ? activeLease.expiresAt
          : expiresAt;
      this.store.systemError(
        run.response.id,
        "RUNNER_UNAVAILABLE",
        "The runner did not accept the run.",
        true,
      );
      // A transport failure is ambiguous: the runner may have accepted the
      // request before its response was lost. Ask it to cancel and retain the
      // original lease window before allowing another run to start.
      void this.runner.cancel(run.response.id).catch(() => undefined);
      this.active = null;
      this.deferDispatch(Math.max(0, quarantineExpiresAt - Date.now()));
    }
  }

  heartbeat(
    runId: string,
    leaseId: string,
    stage: NormalizedCheck["stage"] | null,
  ): HeartbeatOutcome {
    if (!this.store.get(runId)) return { kind: "RUN_NOT_FOUND" };
    if (!this.isActiveLease(runId, leaseId)) return { kind: "LEASE_EXPIRED" };
    if (!this.store.heartbeat(runId, stage)) return { kind: "LEASE_EXPIRED" };

    const expiresAt = Date.now() + this.leaseDurationMs;
    this.active = { id: runId, leaseId, expiresAt };
    return { kind: "ACCEPTED", leaseExpiresAt: new Date(expiresAt).toISOString() };
  }

  async result(
    runId: string,
    result: InternalResultDeliveryRequest,
  ): Promise<ResultDeliveryOutcome> {
    const resultFingerprint = createHash("sha256").update(canonicalize(result)).digest("hex");
    const persisted = this.store.resultDeliveryOutcome(runId, resultFingerprint);
    if (persisted !== "PENDING") return persisted;
    if (!this.isActiveLease(runId, result.leaseId)) return "LEASE_EXPIRED";

    if (result.status === "SYSTEM_ERROR") {
      if (!this.store.systemError(
        runId,
        "RUNNER_FAILURE",
        "The runner could not complete this run.",
        result.systemError.retryable,
        resultFingerprint,
      )) {
        const outcome = this.store.resultDeliveryOutcome(runId, resultFingerprint);
        return outcome === "PENDING" ? "LEASE_EXPIRED" : outcome;
      }
    } else {
      try {
        const receipt = this.receipts.issue(result.report);
        if (!this.store.complete(
          runId,
          result.status,
          result.report,
          receipt,
          resultFingerprint,
        )) {
          const outcome = this.store.resultDeliveryOutcome(runId, resultFingerprint);
          if (outcome !== "PENDING") return outcome;
          throw new Error("RESULT_PERSISTENCE_FAILED");
        }
      } catch {
        this.store.systemError(
          runId,
          "RECEIPT_ISSUANCE_FAILED",
          "The verification receipt could not be issued.",
          true,
        );
        this.active = null;
        await this.dispatchNext();
        return "LEASE_EXPIRED";
      }
    }

    this.active = null;
    await this.dispatchNext();
    return "ACCEPTED";
  }

  private isActiveLease(runId: string, leaseId: string): boolean {
    return Boolean(
      this.active &&
        this.active.id === runId &&
        this.active.leaseId === leaseId &&
        Date.now() < this.active.expiresAt,
    );
  }

  private async expireLease(): Promise<void> {
    if (!this.active || Date.now() < this.active.expiresAt) return;

    const expired = this.active;
    this.active = null;
    try {
      await this.runner.cancel(expired.id);
    } catch {
      // The persisted terminal state below is authoritative if the runner is down.
    }
    this.store.systemError(
      expired.id,
      "LEASE_EXPIRED",
      "The runner lease expired before completion.",
      true,
    );
    await this.dispatchNext();
  }

  private deferDispatch(delayMs = 1_000): void {
    this.dispatchBlockedUntil = Math.max(this.dispatchBlockedUntil, Date.now() + delayMs);
    if (this.dispatchTimer) return;
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      const remaining = this.dispatchBlockedUntil - Date.now();
      if (remaining > 0) {
        this.deferDispatch(remaining);
        return;
      }
      void this.dispatchNext();
    }, delayMs);
    this.dispatchTimer.unref();
  }
}
