"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = "/workspace/repo";
const repositoryBytes = Number(process.env.REPOSITORY_BYTES);
const fileCountLimit = Number(process.env.FILE_COUNT);
const lifecycleScripts = JSON.parse(process.env.LIFECYCLE_SCRIPTS || "[]");

const reject = (code, message) => {
  process.stdout.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  process.exit(2);
};

let files = 0;
let bytes = 0;

const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const child = path.join(directory, entry.name);
    const metadata = fs.lstatSync(child);
    if (metadata.isSymbolicLink()) {
      reject("SYMLINKS_UNSUPPORTED", "Repository symbolic links are unsupported");
    }
    if (metadata.isDirectory()) {
      visit(child);
      continue;
    }
    files += 1;
    bytes += metadata.size;
    if (files > fileCountLimit) {
      reject("FILE_COUNT_LIMIT_EXCEEDED", "Repository file count limit exceeded");
    }
    if (bytes > repositoryBytes) {
      reject("REPOSITORY_LIMIT_EXCEEDED", "Repository byte limit exceeded");
    }
    if (entry.name === ".lfsconfig") {
      reject("GIT_LFS_UNSUPPORTED", "Git LFS is unsupported");
    }
    if (
      entry.name === ".gitattributes" &&
      /filter=lfs/i.test(fs.readFileSync(child, "utf8"))
    ) {
      reject("GIT_LFS_UNSUPPORTED", "Git LFS is unsupported");
    }
  }
};

if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
  reject("NO_SUPPORTED_SKILL", "Repository checkout is missing");
}
if (fs.existsSync(path.join(root, ".gitmodules"))) {
  reject("SUBMODULES_UNSUPPORTED", "Git submodules are unsupported");
}
visit(root);

const entries = new Set(fs.readdirSync(root));
const npm = entries.has("package-lock.json");
const pnpm = entries.has("pnpm-lock.yaml");
if (!npm && !pnpm) reject("LOCKFILE_MISSING", "A supported root lockfile is required");
if (npm && pnpm) {
  reject("LOCKFILE_MISMATCH", "Exactly one supported root lockfile is required");
}
const packagePath = path.join(root, "package.json");
if (!fs.existsSync(packagePath) || !fs.lstatSync(packagePath).isFile()) {
  reject("NO_SUPPORTED_SKILL", "A regular root package.json is required");
}

let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
} catch {
  reject("NO_SUPPORTED_SKILL", "Root package.json is invalid");
}
const scripts =
  packageJson.scripts && typeof packageJson.scripts === "object"
    ? packageJson.scripts
    : {};
const lifecycle = lifecycleScripts.find(
  (name) => typeof scripts[name] === "string",
);
if (lifecycle) {
  reject(
    "LIFECYCLE_SCRIPTS_REQUIRED",
    `Install lifecycle script '${lifecycle}' is not executed`,
  );
}
const packageManager = npm ? "npm" : "pnpm";
if (
  packageJson.packageManager &&
  !packageJson.packageManager.startsWith(`${packageManager}@`)
) {
  reject(
    "LOCKFILE_MISMATCH",
    "packageManager does not match the root lockfile",
  );
}
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    packageManager,
    hasBuild: typeof scripts.build === "string",
    hasTest: typeof scripts.test === "string",
  })}\n`,
);
