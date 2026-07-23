import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  InternalResultDeliveryRequestSchema,
  MOCK_RUN_RESPONSES,
  RunResponseSchema,
} from "@ever-guild/proof-runner-schema";

describe("runner contract consumer", () => {
  it.each(Object.entries(MOCK_RUN_RESPONSES))("accepts the %s mock", (_, mock) => {
    expect(RunResponseSchema.parse(mock).contractVersion).toBe(CONTRACT_VERSION);
  });

  it("rejects incompatible result delivery versions", () => {
    const report = MOCK_RUN_RESPONSES.PASS.report;
    if (report === null) {
      throw new Error("PASS mock must include a report");
    }
    const candidate = {
      contractVersion: "0.9",
      leaseId: "018f47ac-5d7b-7c20-a1aa-0242ac120003",
      completedAt: "2026-07-23T10:01:00.000Z",
      status: "COMPLETED",
      report,
      systemError: null,
    };

    expect(InternalResultDeliveryRequestSchema.safeParse(candidate).success).toBe(false);
    expect(
      InternalResultDeliveryRequestSchema.safeParse({
        ...candidate,
        contractVersion: CONTRACT_VERSION,
      }).success,
    ).toBe(true);
  });

  it("preserves and validates terminal result status", () => {
    const report = MOCK_RUN_RESPONSES.INCONCLUSIVE.report;
    if (report === null) {
      throw new Error("INCONCLUSIVE mock must include a report");
    }
    const timeout = InternalResultDeliveryRequestSchema.parse({
      contractVersion: CONTRACT_VERSION,
      leaseId: "018f47ac-5d7b-7c20-a1aa-0242ac120003",
      completedAt: "2026-07-23T10:01:00.000Z",
      status: "TIMEOUT",
      report,
      systemError: null,
    });

    expect(timeout.status).toBe("TIMEOUT");
  });
});
