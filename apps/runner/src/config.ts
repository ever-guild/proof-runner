import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunnerLimits {
  repositoryBytes: number;
  fileCount: number;
  diskBytes: number;
  cpuCount: number;
  memoryBytes: number;
  pids: number;
  executionMs: number;
  commandOutputBytes: number;
}

export interface RunnerConfig {
  host: string;
  port: number;
  bearerToken: string;
  apiCallbackUrl: string | null;
  leaseExtensionMs: number;
  runtimeImage: string;
  proxyImage: string;
  workspaceRoot: string;
  limits: RunnerLimits;
}

export const HARD_EXECUTION_TIMEOUT_MS = 180_000;

const isInternalServiceUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || !url.hostname.includes(".");
  } catch {
    return false;
  }
};

const integer = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
): number => {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
};

export const loadRunnerConfig = (
  env: NodeJS.ProcessEnv = process.env,
): RunnerConfig => {
  const bearerToken = env.PROOF_RUNNER_BEARER_TOKEN;
  if (!bearerToken || bearerToken.length < 32) {
    throw new Error("PROOF_RUNNER_BEARER_TOKEN must contain at least 32 characters");
  }
  const apiCallbackUrl = env.PROOF_RUNNER_API_URL ?? null;
  if (apiCallbackUrl !== null && !isInternalServiceUrl(apiCallbackUrl)) {
    throw new Error("PROOF_RUNNER_API_URL must be an internal HTTP(S) URL");
  }

  return {
    host: env.PROOF_RUNNER_HOST ?? "127.0.0.1",
    port: integer(env, "PROOF_RUNNER_PORT", 8788, 1),
    bearerToken,
    apiCallbackUrl,
    leaseExtensionMs: integer(
      env,
      "PROOF_RUNNER_LEASE_EXTENSION_MS",
      30_000,
      1_000,
    ),
    runtimeImage: env.PROOF_RUNNER_RUNTIME_IMAGE ?? "proof-runner-node:1",
    proxyImage:
      env.PROOF_RUNNER_PROXY_IMAGE ??
      "ubuntu/squid@sha256:3de2e64f0ca6efdac3e98557607dc0f23050037f3885016d5d5bfcf9950501b8",
    workspaceRoot:
      env.PROOF_RUNNER_WORKSPACE_ROOT ??
      join(tmpdir(), "proof-runner-workspaces"),
    limits: {
      repositoryBytes: integer(
        env,
        "PROOF_RUNNER_REPOSITORY_BYTES",
        100 * 1024 * 1024,
        1,
      ),
      fileCount: integer(env, "PROOF_RUNNER_FILE_COUNT", 20_000, 1),
      diskBytes: integer(
        env,
        "PROOF_RUNNER_DISK_BYTES",
        512 * 1024 * 1024,
        1,
      ),
      cpuCount: integer(env, "PROOF_RUNNER_CPU_COUNT", 1, 1),
      memoryBytes: integer(
        env,
        "PROOF_RUNNER_MEMORY_BYTES",
        512 * 1024 * 1024,
        16 * 1024 * 1024,
      ),
      pids: integer(env, "PROOF_RUNNER_PIDS", 128, 16),
      executionMs: Math.min(
        integer(
          env,
          "PROOF_RUNNER_EXECUTION_MS",
          HARD_EXECUTION_TIMEOUT_MS,
          1_000,
        ),
        HARD_EXECUTION_TIMEOUT_MS,
      ),
      commandOutputBytes: integer(
        env,
        "PROOF_RUNNER_OUTPUT_BYTES",
        1024 * 1024,
        1024,
      ),
    },
  };
};

export const ephemeralToken = (): string => randomBytes(32).toString("hex");
