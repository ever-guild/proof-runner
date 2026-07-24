import {
  CONTRACT_VERSION,
  type InternalResultDeliveryRequest,
  type NormalizedCheck,
} from "@ever-guild/proof-runner-schema";
import type { RunnerConfig } from "./config.js";

export interface ApiCallbackClient {
  heartbeat(runId: string, leaseId: string, activeStage: NormalizedCheck["stage"] | null): Promise<string>;
  result(runId: string, result: InternalResultDeliveryRequest): Promise<void>;
}

export class HttpApiCallbackClient implements ApiCallbackClient {
  constructor(private readonly baseUrl: string, private readonly bearerToken: string) {}
  private async send(path: string, method: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${this.bearerToken}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("API_CALLBACK_FAILED");
    return response;
  }
  async heartbeat(runId: string, leaseId: string, activeStage: NormalizedCheck["stage"] | null): Promise<string> {
    const response = await this.send(`/internal/v1/runs/${encodeURIComponent(runId)}/heartbeat`, "POST", { contractVersion: CONTRACT_VERSION, leaseId, observedAt: new Date().toISOString(), activeStage });
    const body = await response.json() as { lease?: { leaseExpiresAt?: unknown } };
    if (typeof body.lease?.leaseExpiresAt !== "string") throw new Error("API_CALLBACK_INVALID_RESPONSE");
    return body.lease.leaseExpiresAt;
  }
  async result(runId: string, result: InternalResultDeliveryRequest): Promise<void> {
    await this.send(`/internal/v1/runs/${encodeURIComponent(runId)}/result`, "PUT", result);
  }
}

export const callbackClientFor = (config: RunnerConfig): ApiCallbackClient | null => config.apiCallbackUrl ? new HttpApiCallbackClient(config.apiCallbackUrl, config.bearerToken) : null;
