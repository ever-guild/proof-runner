import { describe, expect, it } from "vitest";
import {
  A2MCP_ROUTES,
  CONTRACT_VERSION,
  InspectRepositoryA2McpResponseSchema,
  InternalDispatchRequestSchema,
  MOCK_RUN_RESPONSES,
  PUBLIC_API_ROUTES,
  RunResponseSchema,
  RunQueueFullResponseSchema,
  VerifyHttpRequestSchema,
  VerifyCreationResponseSchema,
  VerifyRepositoryA2McpRequestSchema,
  X402PaymentRequiredV2Schema,
} from "../src/index.js";

describe("frozen public contracts", () => {
  it("freezes canonical public API routes", () => {
    expect(PUBLIC_API_ROUTES).toEqual({
      inspect: { method: "POST", path: "/api/inspect" },
      verify: { method: "POST", path: "/api/verify" },
      run: { method: "GET", path: "/api/runs/:id" },
      receipt: { method: "GET", path: "/api/receipts/:id" },
    });
  });

  it.each(Object.entries(MOCK_RUN_RESPONSES))(
    "validates the %s mock response",
    (_, response) => {
      expect(RunResponseSchema.parse(response)).toEqual(response);
    },
  );

  it("keeps system error and timeout distinct from FAIL", () => {
    const systemError = MOCK_RUN_RESPONSES.SYSTEM_ERROR;
    expect(systemError.status).toBe("SYSTEM_ERROR");
    expect(systemError.verdict).toBe("INCONCLUSIVE");

    const invalidTimeout = {
      ...systemError,
      status: "TIMEOUT",
      verdict: "FAIL",
      systemError: null,
    };
    expect(RunResponseSchema.safeParse(invalidTimeout).success).toBe(false);
  });

  it("rejects contradictory state-specific fields", () => {
    const systemErrorWithoutDetails = {
      ...MOCK_RUN_RESPONSES.SYSTEM_ERROR,
      systemError: null,
    };
    expect(
      RunResponseSchema.safeParse(systemErrorWithoutDetails).success,
    ).toBe(false);

    const runningWithError = {
      ...MOCK_RUN_RESPONSES.SYSTEM_ERROR,
      status: "RUNNING",
      verdict: null,
      activeStage: "TEST",
      completedAt: null,
    };
    expect(RunResponseSchema.safeParse(runningWithError).success).toBe(false);
  });

  it("requires verification idempotency keys at the HTTP boundary", () => {
    expect(
      VerifyHttpRequestSchema.safeParse({
        headers: {},
        body: {},
      }).success,
    ).toBe(false);
    expect(
      VerifyCreationResponseSchema.parse({
        contractVersion: CONTRACT_VERSION,
        run: MOCK_RUN_RESPONSES.PASS,
        replayed: true,
      }).replayed,
    ).toBe(true);
  });

  it("defines the bounded queue-full response", () => {
    expect(
      RunQueueFullResponseSchema.parse({
        contractVersion: CONTRACT_VERSION,
        error: {
          code: "RUN_QUEUE_FULL",
          message: "One run is active and five are waiting.",
          retryable: true,
          capacity: { active: 1, waiting: 5 },
        },
      }).error.capacity,
    ).toEqual({ active: 1, waiting: 5 });
  });

  it("rejects contradictory report verdicts and checks", () => {
    const pass = MOCK_RUN_RESPONSES.PASS;
    const contradictory = {
      ...pass,
      report: {
        ...pass.report,
        checks: pass.report?.checks.map((check) => ({
          ...check,
          outcome: "FAILED",
        })),
      },
    };
    expect(RunResponseSchema.safeParse(contradictory).success).toBe(false);
  });
});

describe("frozen internal runner contracts", () => {
  it("rejects a contract version mismatch", () => {
    expect(
      InternalDispatchRequestSchema.safeParse({
        contractVersion: "2.0",
      }).success,
    ).toBe(false);
  });
});

describe("frozen A2MCP contracts", () => {
  it("defines free 200 and paid 402 behavior", () => {
    expect(A2MCP_ROUTES.inspectRepository.freeStatus).toBe(200);
    expect(A2MCP_ROUTES.verifyRepository.freeStatus).toBe(200);
    expect(A2MCP_ROUTES.verifyRepository.paymentRequiredStatus).toBe(402);
    expect(A2MCP_ROUTES.verifyRepository.paymentRequiredHeader).toBe(
      "PAYMENT-REQUIRED",
    );
  });

  it("requires idempotency on verify_repository", () => {
    expect(
      VerifyRepositoryA2McpRequestSchema.safeParse({
        contractVersion: CONTRACT_VERSION,
      }).success,
    ).toBe(false);
  });

  it("uses a typed inspect response envelope", () => {
    expect(
      InspectRepositoryA2McpResponseSchema.safeParse({
        contractVersion: CONTRACT_VERSION,
        operation: "inspect_repository",
        result: {
          contractVersion: CONTRACT_VERSION,
          supported: false,
          reason: "LOCKFILE_MISSING",
          message: "A supported lockfile is required.",
        },
      }).success,
    ).toBe(true);
  });

  it("models the x402 v2 PAYMENT-REQUIRED challenge", () => {
    expect(
      X402PaymentRequiredV2Schema.safeParse({
        x402Version: 2,
        resource: {
          url: "https://proof.example/a2mcp/verify_repository",
          description: "Verify a repository",
          mimeType: "application/json",
        },
        accepts: [
          {
            scheme: "exact",
            network: "eip155:196",
            asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
            amount: "10000",
            payTo: "0x1111111111111111111111111111111111111111",
            maxTimeoutSeconds: 300,
            extra: { name: "USD₮0", version: "1" },
          },
        ],
      }).success,
    ).toBe(true);
  });
});
