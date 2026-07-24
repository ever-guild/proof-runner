import {
  CONTRACT_VERSION,
  INTERNAL_API_CALLBACK_ROUTES,
  InternalHeartbeatResponseSchema,
  InternalResultDeliveryResponseSchema,
  isInternalServiceUrl,
  type InternalResultDeliveryRequest,
  type NormalizedCheck,
} from "@ever-guild/proof-runner-schema";
import type { RunnerConfig } from "./config.js";

export interface ApiCallbackClient {
  heartbeat(
    runId: string,
    leaseId: string,
    activeStage: NormalizedCheck["stage"] | null,
  ): Promise<{ leaseExpiresAt: string; cancellationRequested: boolean }>;
  result(runId: string, result: InternalResultDeliveryRequest): Promise<void>;
}

export class HttpApiCallbackClient implements ApiCallbackClient {
  constructor(
    private readonly baseUrl: string,
    private readonly bearerToken: string,
  ) {}

  async heartbeat(
    runId: string,
    leaseId: string,
    activeStage: NormalizedCheck["stage"] | null,
  ): Promise<{ leaseExpiresAt: string; cancellationRequested: boolean }> {
    const response = await this.send(
      callbackPath(INTERNAL_API_CALLBACK_ROUTES.heartbeat.path, runId),
      "POST",
      {
        contractVersion: CONTRACT_VERSION,
        leaseId,
        observedAt: new Date().toISOString(),
        activeStage,
      },
    );
    const body = InternalHeartbeatResponseSchema.parse(await response.json());
    return {
      leaseExpiresAt: body.lease.leaseExpiresAt,
      cancellationRequested: body.cancellationRequested,
    };
  }

  async result(runId: string, result: InternalResultDeliveryRequest): Promise<void> {
    const response = await this.send(
      callbackPath(INTERNAL_API_CALLBACK_ROUTES.result.path, runId),
      "PUT",
      result,
    );
    InternalResultDeliveryResponseSchema.parse(await response.json());
  }

  private async send(
    path: string,
    method: "POST" | "PUT",
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
    if (!response.ok) throw new Error("API_CALLBACK_FAILED");
    return response;
  }
}

const callbackPath = (template: string, runId: string): string =>
  template.replace(":id", encodeURIComponent(runId));

export const callbackClientFor = (config: RunnerConfig): ApiCallbackClient => {
  if (!config.apiCallbackUrl || !isInternalServiceUrl(config.apiCallbackUrl)) {
    throw new Error("Runner callback URL is required for the API callback client");
  }
  return new HttpApiCallbackClient(config.apiCallbackUrl, config.bearerToken);
};
