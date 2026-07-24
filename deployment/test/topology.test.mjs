import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const execFile = promisify(execFileCallback);
const service = (compose, name) =>
  compose.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  \\w|^networks:)`, "m"))?.[0] ?? "";

test("the HTTPS edge routes public API, A2MCP, and health requests to the API service", async () => {
  const caddyfile = await read("Caddyfile");
  assert.match(caddyfile, /@api path \/api\/\* \/a2mcp\/\* \/health\/\*/);
  assert.match(caddyfile, /reverse_proxy @api api:8787/);
});

test("nginx config routes SPA fallback for human users and proxies bot crawlers to API", async () => {
  const nginx = await read("nginx.conf");
  assert.match(nginx, /location \/api\//);
  assert.match(nginx, /proxy_pass http:\/\/api:8787;/);
  assert.match(nginx, /location ~ \^\/\(receipts\|examples\)\//);
  assert.match(nginx, /facebookexternalhit\|twitterbot\|slackbot\|linkedinbot\|bot\|crawler\|spider/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
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
