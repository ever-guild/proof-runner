import { randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION,
  type InternalResultDeliveryRequest,
  type NormalizedCheck,
  type SignedReceipt,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import { RunStore } from "./store.js";

export interface RunnerClient {
  dispatch(body: { contractVersion: "1.0"; runId: string; lease: { leaseId: string; leaseExpiresAt: string }; request: unknown }): Promise<void>;
  cancel(runId: string): Promise<void>;
}

export class HttpRunnerClient implements RunnerClient {
  constructor(private readonly url: string, private readonly token: string) {}
  private async request(path: string, method: string, body?: unknown): Promise<void> {
    const init: RequestInit = {
      method, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${this.url}${path}`, init);
    if (!response.ok) throw new Error("RUNNER_UNAVAILABLE");
  }
  dispatch(body: Parameters<RunnerClient["dispatch"]>[0]): Promise<void> { return this.request("/internal/v1/runs", "POST", body); }
  cancel(runId: string): Promise<void> { return this.request(`/internal/v1/runs/${encodeURIComponent(runId)}/cancel`, "POST", { contractVersion: CONTRACT_VERSION, reason: "LEASE_EXPIRED", requestedAt: new Date().toISOString() }); }
}

export interface ReceiptIssuer { issue(report: VerificationReport): SignedReceipt; }

export class Orchestrator {
  private active: { id: string; leaseId: string; expiresAt: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: RunStore,
    private readonly runner: RunnerClient,
    private readonly receiptIssuer: ReceiptIssuer,
    private readonly leaseMs = 30_000,
  ) {}

  start(): void {
    this.store.recoverInterruptedRuns();
    this.timer = setInterval(() => void this.expireLease(), 250);
    this.timer.unref();
    void this.dispatchNext();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); if (this.retryTimer) clearTimeout(this.retryTimer); this.timer = null; this.retryTimer = null; }

  async dispatchNext(): Promise<void> {
    if (this.active) return;
    const run = this.store.claimNext();
    if (!run) return;
    const leaseId = randomUUID();
    const expiresAt = Date.now() + this.leaseMs;
    this.active = { id: run.response.id, leaseId, expiresAt };
    try {
      await this.runner.dispatch({ contractVersion: CONTRACT_VERSION, runId: run.response.id, lease: { leaseId, leaseExpiresAt: new Date(expiresAt).toISOString() }, request: run.request });
    } catch {
      this.store.requeue(run.response.id);
      this.active = null;
      this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.dispatchNext(); }, 1_000);
    }
  }

  heartbeat(runId: string, leaseId: string, stage: NormalizedCheck["stage"] | null): string | null {
    if (!this.active || this.active.id !== runId || this.active.leaseId !== leaseId || Date.now() >= this.active.expiresAt) return null;
    this.active.expiresAt = Date.now() + this.leaseMs;
    return this.store.heartbeat(runId, stage) ? new Date(this.active.expiresAt).toISOString() : null;
  }

  async result(runId: string, result: InternalResultDeliveryRequest): Promise<boolean> {
    if (!this.active || this.active.id !== runId || this.active.leaseId !== result.leaseId || Date.now() >= this.active.expiresAt) return false;
    let stored;
    if (result.status === "SYSTEM_ERROR") {
      stored = this.store.systemError(runId, result.systemError.code, "The runner reported a system error.", result.systemError.retryable);
    } else {
      const active = this.store.get(runId);
      if (!active) return false;
      try {
        stored = this.store.complete(runId, result.status, result.report, this.receiptIssuer.issue(result.report));
      } catch {
        stored = this.store.systemError(runId, "RECEIPT_ISSUANCE_FAILED", "The receipt could not be issued.", true);
      }
    }
    if (!stored) return false;
    this.active = null;
    await this.dispatchNext();
    return true;
  }

  private async expireLease(): Promise<void> {
    if (!this.active || Date.now() < this.active.expiresAt) return;
    const expired = this.active;
    this.active = null;
    try { await this.runner.cancel(expired.id); } catch { /* local terminal state is authoritative */ }
    this.store.systemError(expired.id, "LEASE_EXPIRED", "The runner lease expired before completion.", true);
    await this.dispatchNext();
  }
}
