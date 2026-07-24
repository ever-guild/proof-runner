import { timingSafeEqual } from "node:crypto";
import {
  CONTRACT_VERSION,
  type InternalDispatchRequest,
  type InternalResultDeliveryRequest,
} from "@ever-guild/proof-runner-schema";
import type { RunnerConfig } from "./config.js";
import { RunnerError } from "./errors.js";
import type { SandboxExecution } from "./sandbox.js";
import { DockerSandbox } from "./sandbox.js";
import { callbackClientFor, type ApiCallbackClient } from "./api-client.js";

export type TransportErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "VERSION_MISMATCH"
  | "RUN_NOT_FOUND"
  | "RUN_ALREADY_DISPATCHED"
  | "RUN_ALREADY_TERMINAL"
  | "LEASE_MISMATCH"
  | "LEASE_EXPIRED"
  | "RESULT_CONFLICT"
  | "RUNNER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class TransportError extends Error {
  constructor(
    readonly code: TransportErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

interface StoredRun {
  dispatch: InternalDispatchRequest;
  leaseExpiresAt: string;
  status: "RUNNING" | "COMPLETED" | "TIMEOUT" | "SYSTEM_ERROR";
  activeStage:
    | "REPOSITORY"
    | "SANDBOX"
    | "INSTALL"
    | "BUILD"
    | "TEST"
    | "RECEIPT"
    | null;
  cancellationRequested: boolean;
  lastHeartbeatAt: string;
  result: InternalResultDeliveryRequest | null;
  abort: AbortController;
}

const sameResult = (
  left: InternalResultDeliveryRequest,
  right: InternalResultDeliveryRequest,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export class RunnerService {
  private readonly runs = new Map<string, StoredRun>();
  private activeRunId: string | null = null;

  constructor(
    readonly config: RunnerConfig,
    private readonly sandbox: Pick<DockerSandbox, "execute"> = new DockerSandbox(
      config,
    ),
    private readonly callback: ApiCallbackClient | null = callbackClientFor(config),
  ) {}

  authenticate(header: string | undefined): void {
    const prefix = "Bearer ";
    if (!header?.startsWith(prefix)) {
      throw new TransportError("UNAUTHORIZED", "Bearer token is required", 401);
    }
    const supplied = Buffer.from(header.slice(prefix.length));
    const expected = Buffer.from(this.config.bearerToken);
    if (
      supplied.byteLength !== expected.byteLength ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new TransportError("UNAUTHORIZED", "Bearer token is invalid", 401);
    }
  }

  dispatch(request: InternalDispatchRequest): {
    contractVersion: typeof CONTRACT_VERSION;
    runId: string;
    accepted: true;
    lease: { leaseId: string; leaseExpiresAt: string };
  } {
    if (this.runs.has(request.runId)) {
      throw new TransportError(
        "RUN_ALREADY_DISPATCHED",
        "Run was already dispatched",
        409,
      );
    }
    if (this.activeRunId !== null) {
      throw new TransportError(
        "RUNNER_UNAVAILABLE",
        "Runner concurrency is one",
        503,
        true,
      );
    }
    if (new Date(request.lease.leaseExpiresAt).getTime() <= Date.now()) {
      throw new TransportError("LEASE_EXPIRED", "Dispatch lease expired", 409);
    }
    const now = new Date().toISOString();
    const stored: StoredRun = {
      dispatch: request,
      leaseExpiresAt: request.lease.leaseExpiresAt,
      status: "RUNNING",
      activeStage: "SANDBOX",
      cancellationRequested: false,
      lastHeartbeatAt: now,
      result: null,
      abort: new AbortController(),
    };
    this.runs.set(request.runId, stored);
    this.activeRunId = request.runId;
    void this.execute(stored);
    return {
      contractVersion: CONTRACT_VERSION,
      runId: request.runId,
      accepted: true,
      lease: {
        leaseId: request.lease.leaseId,
        leaseExpiresAt: stored.leaseExpiresAt,
      },
    };
  }

  heartbeat(
    runId: string,
    leaseId: string,
    observedAt: string,
    activeStage: StoredRun["activeStage"],
  ): {
    contractVersion: typeof CONTRACT_VERSION;
    lease: { leaseId: string; leaseExpiresAt: string };
    cancellationRequested: boolean;
  } {
    const run = this.running(runId, leaseId);
    run.lastHeartbeatAt = observedAt;
    run.activeStage = activeStage;
    run.leaseExpiresAt = new Date(
      Date.now() + this.config.leaseExtensionMs,
    ).toISOString();
    return {
      contractVersion: CONTRACT_VERSION,
      lease: {
        leaseId,
        leaseExpiresAt: run.leaseExpiresAt,
      },
      cancellationRequested: run.cancellationRequested,
    };
  }

  status(runId: string): {
    contractVersion: typeof CONTRACT_VERSION;
    runId: string;
    lease: { leaseId: string; leaseExpiresAt: string };
    status: StoredRun["status"];
    activeStage: StoredRun["activeStage"];
    cancellationRequested: boolean;
    lastHeartbeatAt: string;
  } {
    const run = this.find(runId);
    return {
      contractVersion: CONTRACT_VERSION,
      runId,
      lease: {
        leaseId: run.dispatch.lease.leaseId,
        leaseExpiresAt: run.leaseExpiresAt,
      },
      status: run.status,
      activeStage: run.status === "RUNNING" ? run.activeStage : null,
      cancellationRequested: run.cancellationRequested,
      lastHeartbeatAt: run.lastHeartbeatAt,
    };
  }

  deliverResult(
    runId: string,
    result: InternalResultDeliveryRequest,
  ): {
    contractVersion: typeof CONTRACT_VERSION;
    runId: string;
    accepted: true;
  } {
    const run = this.find(runId);
    this.assertLease(run, result.leaseId);
    if (run.result) {
      if (!sameResult(run.result, result)) {
        throw new TransportError(
          "RESULT_CONFLICT",
          "A different terminal result is already stored",
          409,
        );
      }
    } else {
      run.result = result;
      run.status = result.status;
      run.activeStage = null;
      run.abort.abort();
    }
    return { contractVersion: CONTRACT_VERSION, runId, accepted: true };
  }

  cancel(runId: string): {
    contractVersion: typeof CONTRACT_VERSION;
    runId: string;
    cancellationRequested: true;
  } {
    const run = this.find(runId);
    if (run.status !== "RUNNING") {
      throw new TransportError(
        "RUN_ALREADY_TERMINAL",
        "Run is already terminal",
        409,
      );
    }
    run.cancellationRequested = true;
    run.abort.abort();
    return {
      contractVersion: CONTRACT_VERSION,
      runId,
      cancellationRequested: true,
    };
  }

  result(runId: string): InternalResultDeliveryRequest | null {
    return this.find(runId).result;
  }

  private async execute(run: StoredRun): Promise<void> {
    const heartbeatIntervalMs = Math.max(50, Math.min(1_000, Math.floor(
      Math.max(100, new Date(run.leaseExpiresAt).getTime() - Date.now()) / 2,
    )));
    const heartbeat = setInterval(() => {
      void this.callback?.heartbeat(
        run.dispatch.runId,
        run.dispatch.lease.leaseId,
        run.activeStage,
      ).then((leaseExpiresAt) => { run.leaseExpiresAt = leaseExpiresAt; }).catch(() => undefined);
    }, heartbeatIntervalMs);
    heartbeat.unref();
    let execution: SandboxExecution;
    try {
      execution = await this.sandbox.execute(run.dispatch.runId, run.dispatch.request, {
        signal: run.abort.signal,
        assertActive: () => {
          if (run.cancellationRequested) {
            throw new RunnerError("CANCELLED", "Run was cancelled");
          }
          if (Date.now() >= new Date(run.leaseExpiresAt).getTime()) {
            run.cancellationRequested = true;
            run.abort.abort();
            throw new RunnerError("LEASE_EXPIRED", "Run lease expired");
          }
        },
        onStage: (stage) => {
          run.activeStage = stage;
          void this.callback?.heartbeat(run.dispatch.runId, run.dispatch.lease.leaseId, stage)
            .then((leaseExpiresAt) => { run.leaseExpiresAt = leaseExpiresAt; }).catch(() => undefined);
        },
      });
    } catch (error) {
      execution = {
        status: "SYSTEM_ERROR",
        report: null,
        systemError: {
          code: "RUNNER_FAILURE",
          message: error instanceof Error ? error.message : "Unknown runner failure",
          retryable: true,
        },
      };
    }
    if (run.result !== null) {
      clearInterval(heartbeat);
      this.release(run.dispatch.runId);
      return;
    }
    const completedAt = new Date().toISOString();
    if (execution.status === "SYSTEM_ERROR" || execution.report === null) {
      run.result = {
        contractVersion: CONTRACT_VERSION,
        leaseId: run.dispatch.lease.leaseId,
        completedAt,
        status: "SYSTEM_ERROR",
        report: null,
        systemError: execution.systemError ?? {
          code: "RUNNER_FAILURE",
          message: "Runner failed without a report",
          retryable: true,
        },
      };
    } else {
      run.result = {
        contractVersion: CONTRACT_VERSION,
        leaseId: run.dispatch.lease.leaseId,
        completedAt,
        status: execution.status,
        report: execution.report,
        systemError: null,
      };
    }
    run.status = execution.status;
    run.activeStage = null;
    const result = run.result;
    if (this.callback && result) {
      while (Date.now() < new Date(run.leaseExpiresAt).getTime()) {
        try { await this.callback.result(run.dispatch.runId, result); break; } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
    clearInterval(heartbeat);
    this.release(run.dispatch.runId);
  }

  private find(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) throw new TransportError("RUN_NOT_FOUND", "Run was not found", 404);
    return run;
  }

  private running(runId: string, leaseId: string): StoredRun {
    const run = this.find(runId);
    this.assertLease(run, leaseId);
    if (run.status !== "RUNNING") {
      throw new TransportError(
        "RUN_ALREADY_TERMINAL",
        "Run is already terminal",
        409,
      );
    }
    return run;
  }

  private assertLease(run: StoredRun, leaseId: string): void {
    if (run.dispatch.lease.leaseId !== leaseId) {
      throw new TransportError("LEASE_MISMATCH", "Lease ID does not match", 409);
    }
    if (Date.now() >= new Date(run.leaseExpiresAt).getTime()) {
      run.cancellationRequested = true;
      run.abort.abort();
      throw new TransportError("LEASE_EXPIRED", "Run lease expired", 409);
    }
  }

  private release(runId: string): void {
    if (this.activeRunId === runId) this.activeRunId = null;
  }
}
