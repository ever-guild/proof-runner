import { describe, expect, it } from "vitest";
import {
  HARD_EXECUTION_TIMEOUT_MS,
  loadRunnerConfig,
} from "../src/config.js";

describe("runner configuration", () => {
  it("requires a deployment-scoped bearer token", () => {
    expect(() => loadRunnerConfig({})).toThrow(/BEARER_TOKEN/);
    expect(() =>
      loadRunnerConfig({ PROOF_RUNNER_BEARER_TOKEN: "short" }),
    ).toThrow(/BEARER_TOKEN/);
  });

  it("never permits a timeout above the 180-second hard cap", () => {
    const config = loadRunnerConfig({
      PROOF_RUNNER_BEARER_TOKEN: "a".repeat(32),
      PROOF_RUNNER_EXECUTION_MS: "999999",
    });
    expect(config.limits.executionMs).toBe(HARD_EXECUTION_TIMEOUT_MS);
  });
});
