import { randomUUID } from "node:crypto";
import { CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";
import { loadRunnerConfig } from "./config.js";
import { resolveRepositoryRef, type RepositoryRef } from "./repository.js";
import { DockerSandbox } from "./sandbox.js";
import { loadSkill } from "./skill.js";

const repositoryUrl = process.env.PROOF_RUNNER_BENCHMARK_REPOSITORY_URL;
const refType = process.env.PROOF_RUNNER_BENCHMARK_REF_TYPE as
  | RepositoryRef["type"]
  | undefined;
const refValue = process.env.PROOF_RUNNER_BENCHMARK_REF_VALUE;

if (!repositoryUrl || !refType || !refValue) {
  throw new Error(
    "Set PROOF_RUNNER_BENCHMARK_REPOSITORY_URL, " +
      "PROOF_RUNNER_BENCHMARK_REF_TYPE, and PROOF_RUNNER_BENCHMARK_REF_VALUE",
  );
}
if (!["branch", "tag", "commit"].includes(refType)) {
  throw new Error("PROOF_RUNNER_BENCHMARK_REF_TYPE must be branch, tag, or commit");
}

const config = loadRunnerConfig();
const sandbox = new DockerSandbox(config);
const ref: RepositoryRef = { type: refType, value: refValue };
const resolvedCommitSha = await resolveRepositoryRef(repositoryUrl, ref);
const skill = await loadSkill();
const durations: number[] = [];
let runtimeImageDigest = "";

for (let index = 0; index < 10; index += 1) {
  const result = await sandbox.execute(randomUUID(), {
    contractVersion: CONTRACT_VERSION,
    repositoryUrl,
    resolvedCommitSha,
    resolvedRef: ref,
    skill: {
      name: "node-typescript",
      version: "1",
      hash: skill.hash,
    },
    public: false,
  });
  if (!result.report || result.report.verdict !== "PASS") {
    throw new Error(
      `Benchmark run ${index + 1} did not pass: ${JSON.stringify(result)}`,
    );
  }
  if (result.report.durationMs > config.limits.executionMs) {
    throw new Error(`Benchmark run ${index + 1} exceeded the hard cap`);
  }
  if (
    runtimeImageDigest !== "" &&
    result.report.runtimeImageDigest !== runtimeImageDigest
  ) {
    throw new Error("Runtime image digest changed during benchmark");
  }
  runtimeImageDigest = result.report.runtimeImageDigest;
  durations.push(result.report.durationMs);
}

const ordered = [...durations].sort((left, right) => left - right);
const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Infinity;
const evidence = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl,
  resolvedCommitSha,
  skillHash: skill.hash,
  runtimeImageDigest,
  ref,
  worker:
    process.env.PROOF_RUNNER_BENCHMARK_WORKER ?? "local-dedicated-docker-worker",
  observedAt: new Date().toISOString(),
  runs: durations,
  p95Ms: p95,
  maximumMs: Math.max(...durations),
  hardCapMs: config.limits.executionMs,
  targetP95Ms: 90_000,
  passed: p95 <= 90_000 && Math.max(...durations) <= config.limits.executionMs,
};
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.passed) process.exitCode = 1;
