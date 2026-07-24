import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CONTRACT_VERSION,
  type InspectRequest,
  type InspectResult,
} from "@ever-guild/proof-runner-schema";

export interface InspectionGateway {
  resolve(
    repositoryUrl: string,
    ref: InspectRequest["ref"],
  ): Promise<string>;
  file(
    repositoryUrl: string,
    commit: string,
    path: string,
  ): Promise<string | null>;
}

type Repository = { owner: string; name: string };

const canonicalRepository = (repositoryUrl: string): Repository => {
  const match = repositoryUrl.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/,
  );
  if (!match?.[1] || !match[2] || match[2].endsWith(".git")) {
    throw new Error("INVALID_REPOSITORY_URL");
  }
  return { owner: match[1], name: match[2] };
};

const githubFetch = async (url: string): Promise<Response> =>
  fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "proof-runner/1",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

export const githubInspectionGateway: InspectionGateway = {
  async resolve(repositoryUrl, ref) {
    const { owner, name } = canonicalRepository(repositoryUrl);
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref.value)}`,
    );
    if (response.status === 404 || response.status === 422) {
      throw new Error("REF_NOT_FOUND");
    }
    if (!response.ok) throw new Error("INSPECTION_UNAVAILABLE");

    const body = await response.json() as { sha?: unknown };
    if (typeof body.sha !== "string" || !/^[a-f0-9]{40}$/.test(body.sha)) {
      throw new Error("REF_NOT_FOUND");
    }
    return body.sha;
  },

  async file(repositoryUrl, commit, path) {
    const { owner, name } = canonicalRepository(repositoryUrl);
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(commit)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("INSPECTION_UNAVAILABLE");

    const body = await response.json() as {
      content?: unknown;
      encoding?: unknown;
    };
    if (body.encoding !== "base64" || typeof body.content !== "string") {
      throw new Error("INSPECTION_UNAVAILABLE");
    }
    return Buffer.from(body.content.replaceAll("\n", ""), "base64").toString("utf8");
  },
};

type PackageJson = {
  packageManager?: unknown;
  engines?: { node?: unknown };
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

const nodeTypescriptLifecycleScripts = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare",
  "pnpm:devPreinstall",
] as const;

const nodeTypescriptSkillHash = createHash("sha256")
  .update(
    readFileSync(
      new URL("../../../skills/node-typescript/skill.json", import.meta.url),
    ),
  )
  .digest("hex");

type UnsupportedResult = Extract<InspectResult, { supported: false }>;

export class InspectionUnavailableError extends Error {
  constructor() {
    super("Repository metadata is temporarily unavailable.");
    this.name = "InspectionUnavailableError";
  }
}

const unsupported = (
  reason: UnsupportedResult["reason"],
  message: string,
): UnsupportedResult => ({
  contractVersion: CONTRACT_VERSION,
  supported: false,
  reason,
  message,
});

const isFullCommitSha = (value: string): boolean => /^[a-f0-9]{40}$/.test(value);

/**
 * Reads committed repository metadata only. This module deliberately has no
 * execution interface: inspection can never run arbitrary repository code.
 */
export class InspectionService {
  constructor(
    private readonly gateway: InspectionGateway = githubInspectionGateway,
  ) {}

  async inspect(
    repositoryUrl: string,
    ref: InspectRequest["ref"],
  ): Promise<InspectResult> {
    try {
      canonicalRepository(repositoryUrl);
    } catch {
      return unsupported(
        "INVALID_REPOSITORY_URL",
        "Only canonical public GitHub repository URLs are supported.",
      );
    }

    let resolvedCommitSha: string;
    try {
      resolvedCommitSha = await this.gateway.resolve(repositoryUrl, ref);
    } catch (error) {
      if (error instanceof Error && error.message === "REF_NOT_FOUND") {
        return unsupported(
          "REF_NOT_FOUND",
          "The requested public repository ref could not be resolved.",
        );
      }
      throw new InspectionUnavailableError();
    }
    if (!isFullCommitSha(resolvedCommitSha)) {
      return unsupported(
        "REF_NOT_FOUND",
        "The requested public repository ref did not resolve to an immutable commit.",
      );
    }

    let manifestText: string | null;
    try {
      manifestText = await this.gateway.file(
        repositoryUrl,
        resolvedCommitSha,
        "package.json",
      );
    } catch {
      throw new InspectionUnavailableError();
    }
    if (!manifestText) {
      return unsupported("NO_SUPPORTED_SKILL", "A readable package.json is required.");
    }

    let manifest: PackageJson;
    try {
      manifest = JSON.parse(manifestText) as PackageJson;
    } catch {
      return unsupported("NO_SUPPORTED_SKILL", "package.json must contain valid JSON.");
    }
    const scripts = manifest.scripts ?? {};
    const lifecycle = nodeTypescriptLifecycleScripts.find(
      (script) => typeof scripts[script] === "string",
    );
    if (lifecycle) {
      return unsupported(
        "LIFECYCLE_SCRIPTS_REQUIRED",
        "Install lifecycle scripts are not supported.",
      );
    }

    let files: Array<string | null>;
    try {
      files = await Promise.all([
        this.gateway.file(repositoryUrl, resolvedCommitSha, "package-lock.json"),
        this.gateway.file(repositoryUrl, resolvedCommitSha, "pnpm-lock.yaml"),
        this.gateway.file(repositoryUrl, resolvedCommitSha, "tsconfig.json"),
        this.gateway.file(repositoryUrl, resolvedCommitSha, ".nvmrc"),
      ]);
    } catch {
      throw new InspectionUnavailableError();
    }

    const [npmLock, pnpmLock, tsconfig, nvmrc] = files;
    if (npmLock !== null && pnpmLock !== null) {
      return unsupported(
        "LOCKFILE_MISMATCH",
        "Exactly one supported lockfile is required.",
      );
    }
    if (npmLock === null && pnpmLock === null) {
      return unsupported(
        "LOCKFILE_MISSING",
        "package-lock.json or pnpm-lock.yaml is required.",
      );
    }

    const packageManager = npmLock !== null ? "npm" : "pnpm";
    if (
      typeof manifest.packageManager === "string" &&
      !manifest.packageManager.startsWith(`${packageManager}@`)
    ) {
      return unsupported(
        "LOCKFILE_MISMATCH",
        "packageManager does not match the committed lockfile.",
      );
    }

    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };

    return {
      contractVersion: CONTRACT_VERSION,
      supported: true,
      inspection: {
        repositoryUrl,
        requestedRef: ref,
        resolvedCommitSha,
        packageManager,
        lockfile: npmLock !== null ? "package-lock.json" : "pnpm-lock.yaml",
        nodeVersion:
          typeof manifest.engines?.node === "string"
            ? manifest.engines.node
            : nvmrc?.trim() || null,
        hasTypeScript: tsconfig !== null || "typescript" in dependencies,
        scripts: {
          build: typeof scripts.build === "string" ? scripts.build : null,
          test: typeof scripts.test === "string" ? scripts.test : null,
        },
        selectedSkill: "node-typescript@1",
        selectedSkillHash: nodeTypescriptSkillHash,
      },
    };
  }
}
