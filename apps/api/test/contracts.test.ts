import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  InternalDispatchRequestSchema,
  MOCK_RUN_RESPONSES,
  RunResponseSchema,
} from "@proof-runner/schema";

describe("API contract consumer", () => {
  it.each(Object.entries(MOCK_RUN_RESPONSES))("accepts the %s mock", (_, mock) => {
    expect(RunResponseSchema.parse(mock).contractVersion).toBe(CONTRACT_VERSION);
  });

  it("rejects incompatible runner payload versions", () => {
    const report = MOCK_RUN_RESPONSES.PASS.report;
    if (report === null) {
      throw new Error("PASS mock must include a report");
    }
    const candidate = {
      contractVersion: "2.0",
      runId: "018f47ac-5d7b-7c20-a1aa-0242ac120002",
      lease: {
        leaseId: "018f47ac-5d7b-7c20-a1aa-0242ac120003",
        leaseExpiresAt: "2026-07-23T10:01:00.000Z",
      },
      request: {
        contractVersion: CONTRACT_VERSION,
        repositoryUrl: report.repositoryUrl,
        resolvedCommitSha: report.resolvedCommitSha,
        resolvedRef: report.resolvedRef,
        skill: report.skill,
        public: false,
      },
    };

    expect(InternalDispatchRequestSchema.safeParse(candidate).success).toBe(false);
    expect(
      InternalDispatchRequestSchema.safeParse({
        ...candidate,
        contractVersion: CONTRACT_VERSION,
      }).success,
    ).toBe(true);
  });
});
