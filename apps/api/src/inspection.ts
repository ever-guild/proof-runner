import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type InspectResult, CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";

type Ref = { type: "branch" | "tag" | "commit"; value: string };

export interface InspectionGateway {
  resolve(repositoryUrl: string, ref: Ref): Promise<string>;
  file(repositoryUrl: string, commit: string, path: string): Promise<string | null>;
}

const githubRepository = (repositoryUrl: string): { owner: string; name: string } => {
  const match = repositoryUrl.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match?.[1] || !match[2]) throw new Error("INVALID_REPOSITORY_URL");
  return { owner: match[1], name: match[2] };
};

const githubFetch = async (url: string): Promise<Response> => fetch(url, {
  headers: { accept: "application/vnd.github+json", "user-agent": "proof-runner/1" },
  redirect: "error",
  signal: AbortSignal.timeout(10_000),
});

export const githubInspectionGateway: InspectionGateway = {
  async resolve(repositoryUrl, ref) {
    const { owner, name } = githubRepository(repositoryUrl);
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref.value)}`,
    );
    if (response.status === 404 || response.status === 422) throw new Error("REF_NOT_FOUND");
    if (!response.ok) throw new Error("INSPECTION_UNAVAILABLE");
    const body = await response.json() as { sha?: unknown };
    if (typeof body.sha !== "string" || !/^[a-f0-9]{40}$/.test(body.sha)) {
      throw new Error("REF_NOT_FOUND");
    }
    return body.sha;
  },
  async file(repositoryUrl, commit, path) {
    const { owner, name } = githubRepository(repositoryUrl);
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(commit)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("INSPECTION_UNAVAILABLE");
    const body = await response.json() as { content?: unknown; encoding?: unknown };
    if (body.encoding !== "base64" || typeof body.content !== "string") {
      throw new Error("INSPECTION_UNAVAILABLE");
    }
    return Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8");
  },
};

type PackageJson = {
  packageManager?: unknown;
  engines?: { node?: unknown };
  scripts?: { build?: unknown; test?: unknown };
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};
const LIFECYCLE_SCRIPTS = new Set(["preinstall", "install", "postinstall", "prepublish", "prepare", "pnpm:devPreinstall"]);
const NODE_TYPESCRIPT_SKILL_HASH = createHash("sha256")
  .update(readFileSync(new URL("../../../skills/node-typescript/skill.json", import.meta.url)))
  .digest("hex");

const unsupported = (reason: Extract<InspectResult, { supported: false }>["reason"], message: string): InspectResult => ({
  contractVersion: CONTRACT_VERSION, supported: false, reason, message,
});

export class InspectionService {
  constructor(private readonly gateway: InspectionGateway = githubInspectionGateway) {}

  async inspect(repositoryUrl: string, ref: Ref): Promise<InspectResult> {
    try {
      githubRepository(repositoryUrl);
    } catch {
      return unsupported("INVALID_REPOSITORY_URL", "Only canonical public GitHub repository URLs are supported.");
    }
    let commit: string;
    try {
      commit = await this.gateway.resolve(repositoryUrl, ref);
    } catch (error) {
      return unsupported(
        error instanceof Error && error.message === "REF_NOT_FOUND" ? "REF_NOT_FOUND" : "INVALID_REPOSITORY_URL",
        "The requested public repository ref could not be resolved.",
      );
    }
    const manifestText = await this.gateway.file(repositoryUrl, commit, "package.json").catch(() => null);
    if (!manifestText) return unsupported("NO_SUPPORTED_SKILL", "A readable package.json is required.");
    let manifest: PackageJson;
    try { manifest = JSON.parse(manifestText) as PackageJson; } catch {
      return unsupported("NO_SUPPORTED_SKILL", "package.json must contain valid JSON.");
    }
    const [npmLock, pnpmLock, tsconfig, nvmrc] = await Promise.all([
      this.gateway.file(repositoryUrl, commit, "package-lock.json"),
      this.gateway.file(repositoryUrl, commit, "pnpm-lock.yaml"),
      this.gateway.file(repositoryUrl, commit, "tsconfig.json"),
      this.gateway.file(repositoryUrl, commit, ".nvmrc"),
    ]);
    if (npmLock && pnpmLock) return unsupported("LOCKFILE_MISMATCH", "Exactly one supported lockfile is required.");
    if (!npmLock && !pnpmLock) return unsupported("LOCKFILE_MISSING", "package-lock.json or pnpm-lock.yaml is required.");
    const packageManager = npmLock ? "npm" : "pnpm";
    if (typeof manifest.packageManager === "string" && !manifest.packageManager.startsWith(`${packageManager}@`)) {
      return unsupported("LOCKFILE_MISMATCH", "packageManager does not match the committed lockfile.");
    }
    const allDependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    const scripts = manifest.scripts ?? {};
    if (Object.keys(scripts).some((script) => LIFECYCLE_SCRIPTS.has(script))) {
      return unsupported("LIFECYCLE_SCRIPTS_REQUIRED", "Install lifecycle scripts are not supported.");
    }
    return {
      contractVersion: CONTRACT_VERSION,
      supported: true,
      inspection: {
        repositoryUrl,
        requestedRef: ref,
        resolvedCommitSha: commit,
        packageManager,
        lockfile: npmLock ? "package-lock.json" : "pnpm-lock.yaml",
        nodeVersion: typeof manifest.engines?.node === "string"
          ? manifest.engines.node
          : nvmrc?.trim() || null,
        hasTypeScript: Boolean(tsconfig) || "typescript" in allDependencies,
        scripts: {
          build: typeof scripts.build === "string" ? scripts.build : null,
          test: typeof scripts.test === "string" ? scripts.test : null,
        },
        selectedSkill: "node-typescript@1",
        selectedSkillHash: NODE_TYPESCRIPT_SKILL_HASH,
      },
    };
  }
}
