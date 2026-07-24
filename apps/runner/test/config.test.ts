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
      PROOF_RUNNER_API_URL: "http://127.0.0.1:8787",
      PROOF_RUNNER_EXECUTION_MS: "999999",
    });
    expect(config.limits.executionMs).toBe(HARD_EXECUTION_TIMEOUT_MS);
  });

  it("permits callback-free configuration for standalone sandbox work", () => {
    expect(
      loadRunnerConfig({ PROOF_RUNNER_BEARER_TOKEN: "a".repeat(32) }).apiCallbackUrl,
    ).toBeUndefined();
  });

  it("validates a supplied private API callback URL", () => {
    expect(() =>
      loadRunnerConfig({
        PROOF_RUNNER_BEARER_TOKEN: "a".repeat(32),
        PROOF_RUNNER_API_URL: "http://runner.example.test",
      }),
    ).toThrow(/PROOF_RUNNER_API_URL/);
    expect(() =>
      loadRunnerConfig({
        PROOF_RUNNER_BEARER_TOKEN: "a".repeat(32),
        PROOF_RUNNER_API_URL: "http://127.0.0.1:8787@evil.example",
      }),
    ).toThrow(/PROOF_RUNNER_API_URL/);
  });
});
