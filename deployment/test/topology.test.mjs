import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { build } from "vite";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const execFile = promisify(execFileCallback);
const rootDirectory = fileURLToPath(new URL("../../", import.meta.url));
const composePath = join(rootDirectory, "deployment", "compose.yaml");
const invalidPublicOrigins = [
  "",
  "   ",
  "///",
  "http://proof-runner.example",
  "https://localhost",
  "https://127.0.0.1",
  "https://[::1]",
  "https://proof-runner.example/path",
  "https://proof-runner.example?q=1",
  "https://proof-runner.example#fragment",
  "https://user:pass@proof-runner.example",
  "https://https://proof-runner.example",
];
const service = (compose, name) =>
  compose.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  \\w|^networks:)`, "m"))?.[0] ?? "";
const composeEnvironment = (domain) => {
  const environment = {
    ...process.env,
    PROOF_RUNNER_BEARER_TOKEN: "test-token",
    PROOF_RUNNER_RECEIPT_KEY_ID: "test-key",
    PROOF_RUNNER_RECEIPT_PRIVATE_KEY: "test-private-key",
    PROOF_RUNNER_BACKUP_PATH: join(tmpdir(), "proof-runner-backups"),
    PROOF_RUNNER_RUNTIME_IMAGE: `sha256:${"a".repeat(64)}`,
    PROOF_RUNNER_PROXY_IMAGE: `ubuntu/squid@sha256:${"b".repeat(64)}`,
  };
  if (domain === undefined) {
    delete environment.PROOF_RUNNER_DOMAIN;
  } else {
    environment.PROOF_RUNNER_DOMAIN = domain;
  }
  return environment;
};
const renderCompose = async (domain) => {
  const { stdout } = await execFile(
    "docker",
    ["compose", "-f", composePath, "config", "--format", "json"],
    {
      cwd: rootDirectory,
      env: composeEnvironment(domain),
    },
  );
  return JSON.parse(stdout);
};

test("the HTTPS edge routes public API, A2MCP, and health requests to the API service", async () => {
  const caddyfile = await read("Caddyfile");
  assert.match(caddyfile, /@api path \/api\/\* \/a2mcp\/\* \/health\/\*/);
  assert.match(caddyfile, /reverse_proxy @api api:8787/);
});

test("nginx config routes SPA fallback for human users, proxies bot crawlers to API, and forbids public /internal/ proxy", async () => {
  const nginx = await read("nginx.conf");
  assert.match(nginx, /location \/api\//);
  assert.match(nginx, /proxy_pass http:\/\/api:8787;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Host \$http_x_forwarded_host;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;/);
  assert.match(nginx, /location ~ \^\/\(receipts\|examples\)\//);
  assert.match(nginx, /facebookexternalhit\|twitterbot\|slackbot\|linkedinbot\|bot\|crawler\|spider/);
  assert.match(nginx, /location ~ \^\/\(receipts\|examples\)\/[\s\S]*?proxy_set_header Host \$http_host;/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.doesNotMatch(nginx, /location \/internal\//);
  assert.doesNotMatch(nginx, /proxy_pass http:\/\/api:8787\/internal\//);
  assert.match(nginx, /location = \/internal\s*\{\s*return 404;\s*\}/);
  assert.match(nginx, /location \^~ \/internal\/\s*\{\s*return 404;\s*\}/);
});

test("negative edge configuration rejects and never proxies /internal/ callback routes to upstream API", async () => {
  const nginx = await read("nginx.conf");
  const caddyfile = await read("Caddyfile");

  assert.match(caddyfile, /@api path \/api\/\* \/a2mcp\/\* \/health\/\*/);
  assert.doesNotMatch(caddyfile, /\/internal\//);

  assert.doesNotMatch(nginx, /proxy_pass.*\/internal/);
  const hasInternalProxy = /location\s+(?:=\s+|\^~\s+)?\/internal\/?\s*\{[^}]*proxy_pass/.test(nginx);
  assert.equal(hasInternalProxy, false, "Public edge proxy must not contain any location proxying /internal/");
});


test("Compose gives only the API egress while keeping the worker private and backups retained", async () => {
  const compose = await read("compose.yaml");
  assert.match(compose, /backend:\n    internal: true/);
  assert.match(service(compose, "api"), /networks: \[backend, egress\]/);
  assert.match(service(compose, "runner"), /networks: \[backend\]/);
  assert.doesNotMatch(service(compose, "runner"), /^    ports:/m);
  assert.match(compose, /proof_runner_data:\/var\/lib\/proof-runner:ro/);
  assert.match(compose, /PROOF_RUNNER_BACKUP_PATH.*:\/backups/);
  assert.match(compose, /backup-sqlite\.mjs/);
  assert.match(compose, /PROOF_RUNNER_DOCKER_ASSET_CONTAINER: self/);
});

test("production web build requires and receives the canonical HTTPS origin", async () => {
  const compose = await read("compose.yaml");
  const dockerfile = await read("Dockerfile.web");
  const web = service(compose, "web");

  assert.match(
    web,
    /PUBLIC_BASE_URL: "https:\/\/\$\{PROOF_RUNNER_DOMAIN:\?set the public HTTPS domain\}"/,
  );
  assert.match(dockerfile, /^ARG PUBLIC_BASE_URL$/m);
  assert.match(dockerfile, /^ENV PUBLIC_BASE_URL=\$PUBLIC_BASE_URL$/m);

  const requiredOrigin = dockerfile.indexOf('RUN test -n "$PUBLIC_BASE_URL"');
  const dependencyInstall = dockerfile.indexOf("RUN pnpm install --frozen-lockfile");
  const viteBuild = dockerfile.indexOf("RUN pnpm exec vite build");
  assert.ok(requiredOrigin >= 0, "The production image must reject a missing canonical origin");
  assert.ok(dependencyInstall > requiredOrigin, "A missing canonical origin must fail before dependencies install");
  assert.ok(viteBuild > requiredOrigin, "The canonical origin must be required before Vite builds the image");
});

test("Compose renders a host-only domain and exposes scheme mistakes to build validation", async () => {
  const validConfig = await renderCompose("proof-runner.example");
  assert.equal(
    validConfig.services.web.build.args.PUBLIC_BASE_URL,
    "https://proof-runner.example",
  );

  const invalidConfig = await renderCompose("https://proof-runner.example");
  const invalidOrigin = invalidConfig.services.web.build.args.PUBLIC_BASE_URL;
  assert.equal(invalidOrigin, "https://https://proof-runner.example");
  assert.ok(invalidPublicOrigins.includes(invalidOrigin));

  await assert.rejects(
    renderCompose(undefined),
    /PROOF_RUNNER_DOMAIN[\s\S]*set the public HTTPS domain/,
  );
});

test("production web artifact publishes one canonical origin in HTML, robots, and sitemap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proof-runner-web-build-"));
  const outputDirectory = join(directory, "site");
  const origin = "https://proof-runner.example";
  const previousOrigin = process.env.PUBLIC_BASE_URL;

  try {
    for (const invalidOrigin of invalidPublicOrigins) {
      process.env.PUBLIC_BASE_URL = invalidOrigin;
      await assert.rejects(
        build({
          root: rootDirectory,
          configFile: join(rootDirectory, "vite.config.ts"),
          build: {
            outDir: outputDirectory,
            emptyOutDir: true,
          },
          logLevel: "silent",
        }),
        /Invalid PUBLIC_BASE_URL/,
      );
    }

    process.env.PUBLIC_BASE_URL = origin;
    await build({
      root: rootDirectory,
      configFile: join(rootDirectory, "vite.config.ts"),
      build: {
        outDir: outputDirectory,
        emptyOutDir: true,
      },
      logLevel: "silent",
    });

    const html = await readFile(join(outputDirectory, "index.html"), "utf8");
    const robots = await readFile(join(outputDirectory, "robots.txt"), "utf8");
    const sitemap = await readFile(join(outputDirectory, "sitemap.xml"), "utf8");

    assert.match(html, new RegExp(`<link rel="canonical" href="${origin}/" />`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${origin}/" />`));
    assert.match(robots, new RegExp(`^Sitemap: ${origin}/sitemap\\.xml$`, "m"));

    const metadataUrls = [
      html.match(/<link rel="canonical" href="(https:\/\/[^"]+)" \/>/)?.[1],
      html.match(/<meta property="og:url" content="(https:\/\/[^"]+)" \/>/)?.[1],
      robots.match(/^Sitemap: (https:\/\/\S+)$/m)?.[1],
      ...[...sitemap.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map((match) => match[1]),
    ];
    assert.ok(metadataUrls.every(Boolean), "Every public metadata URL must be absolute");
    const publishedOrigins = [...new Set(metadataUrls.map((url) => new URL(url).origin))];
    assert.deepEqual(publishedOrigins, [origin]);
  } finally {
    if (previousOrigin === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = previousOrigin;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("Compose uses the API runtime bind names and passes every explicit runner policy", async () => {
  const compose = await read("compose.yaml");
  const api = service(compose, "api");
  const runner = service(compose, "runner");
  assert.match(api, /PROOF_RUNNER_API_HOST: 0\.0\.0\.0/);
  assert.match(api, /PROOF_RUNNER_API_PORT: 8787/);
  assert.doesNotMatch(api, /^      HOST:/m);
  assert.doesNotMatch(api, /^      PORT:/m);
  for (const name of [
    "OKX_API_KEY",
    "OKX_SECRET_KEY",
    "OKX_PASSPHRASE",
    "OKX_BASE_URL",
    "PAY_TO_ADDRESS",
    "PROOF_RUNNER_PAYMENT_NETWORK",
    "PROOF_RUNNER_VERIFY_PRICE",
    "PROOF_RUNNER_PAYMENT_MODE",
  ]) {
    assert.match(api, new RegExp(`^      ${name}:`, "m"));
  }
  for (const name of [
    "PROOF_RUNNER_RUNTIME_IMAGE",
    "PROOF_RUNNER_PROXY_IMAGE",
    "PROOF_RUNNER_LEASE_EXTENSION_MS",
    "PROOF_RUNNER_REPOSITORY_BYTES",
    "PROOF_RUNNER_FILE_COUNT",
    "PROOF_RUNNER_DISK_BYTES",
    "PROOF_RUNNER_CPU_COUNT",
    "PROOF_RUNNER_MEMORY_BYTES",
    "PROOF_RUNNER_PIDS",
    "PROOF_RUNNER_EXECUTION_MS",
    "PROOF_RUNNER_OUTPUT_BYTES",
  ]) {
    assert.match(runner, new RegExp(`^      ${name}:`, "m"));
  }
  assert.match(
    runner,
    /PROOF_RUNNER_RUNTIME_IMAGE: \$\{PROOF_RUNNER_RUNTIME_IMAGE:\?pin the runtime image by sha256 digest\}/,
  );
});

test("runner image carries the pinned skill and host-daemon-visible asset volume", async () => {
  const dockerfile = await read("Dockerfile.runner");
  assert.match(dockerfile, /COPY skills\/node-typescript \.\/skills\/node-typescript/);
  assert.match(dockerfile, /\/opt\/proof-runner-assets\/inspect\.cjs/);
  assert.match(dockerfile, /VOLUME \["\/opt\/proof-runner-assets"\]/);
});

test("backup policy validates retention and snapshots SQLite with VACUUM INTO", async () => {
  const backup = await read("backup-sqlite.mjs");
  assert.match(backup, /VACUUM INTO/);
  assert.match(backup, /BACKUP_RETENTION_DAYS/);
  assert.match(backup, /rmSync\(candidate/);
});

test("backup creates a restorable snapshot from a read-only SQLite source and prunes expired files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proof-runner-backup-"));
  const databasePath = join(directory, "runs.sqlite");
  const backupDirectory = join(directory, "backups");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE proof (value TEXT); INSERT INTO proof VALUES ('persisted');");
  database.close();
  try {
    const script = fileURLToPath(new URL("../backup-sqlite.mjs", import.meta.url));
    const result = await execFile(process.execPath, [script], {
      env: { ...process.env, DATABASE_PATH: databasePath, BACKUP_DIRECTORY: backupDirectory, BACKUP_RETENTION_DAYS: "1" },
    });
    const snapshotPath = result.stdout.trim();
    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    assert.equal(snapshot.prepare("SELECT value FROM proof").get().value, "persisted");
    snapshot.close();
    const expired = join(backupDirectory, "runs-expired.sqlite");
    await writeFile(expired, await readFile(snapshotPath));
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(expired, old, old);
    await execFile(process.execPath, [script], {
      env: { ...process.env, DATABASE_PATH: databasePath, BACKUP_DIRECTORY: backupDirectory, BACKUP_RETENTION_DAYS: "1" },
    });
    await assert.rejects(readFile(expired));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
