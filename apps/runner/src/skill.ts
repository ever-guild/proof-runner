import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RunnerError } from "./errors.js";

export interface NodeTypescriptSkill {
  name: "node-typescript";
  version: "1";
  packageManagers: {
    npm: { lockfile: "package-lock.json"; install: string[] };
    pnpm: { lockfile: "pnpm-lock.yaml"; install: string[] };
  };
  commands: {
    npm: { build: string[]; test: string[] };
    pnpm: { build: string[]; test: string[] };
  };
  lifecycleScripts: string[];
}

const defaultSkillPath = fileURLToPath(
  new URL("../../../skills/node-typescript/skill.json", import.meta.url),
);

export const loadSkill = async (
  path = process.env.PROOF_RUNNER_SKILL_PATH ?? defaultSkillPath,
): Promise<{ definition: NodeTypescriptSkill; hash: string; path: string }> => {
  const bytes = await readFile(path);
  const definition = JSON.parse(bytes.toString("utf8")) as NodeTypescriptSkill;
  if (definition.name !== "node-typescript" || definition.version !== "1") {
    throw new RunnerError("RUNNER_FAILURE", "Unsupported runner skill definition");
  }
  return {
    definition,
    hash: createHash("sha256").update(bytes).digest("hex"),
    path,
  };
};

export const assertSkillHash = (actual: string, requested: string): void => {
  if (actual !== requested) {
    throw new RunnerError(
      "SKILL_HASH_MISMATCH",
      "Requested skill hash does not match node-typescript@1",
    );
  }
};
