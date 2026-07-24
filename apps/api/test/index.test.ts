import { describe, expect, it } from "vitest";
import { createProductionApi } from "../src/index.js";

describe("production API configuration", () => {
  it("rejects a runner URL whose user-info disguises a remote HTTP host", () => {
    expect(() =>
      createProductionApi({
        DATABASE_PATH: "/tmp/proof-runner-config.sqlite",
        PROOF_RUNNER_RECEIPT_KEY_ID: "test-key",
        PROOF_RUNNER_RECEIPT_PRIVATE_KEY: "not-reached-for-invalid-runner-url",
        PROOF_RUNNER_BEARER_TOKEN: "t".repeat(32),
        PROOF_RUNNER_RUNNER_URL: "http://127.0.0.1:8787@evil.example",
      }),
    ).toThrow(/PROOF_RUNNER_RUNNER_URL/);
  });
});
