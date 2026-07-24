import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const databasePath = process.env.DATABASE_PATH;
const backupDirectory = process.env.BACKUP_DIRECTORY;
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "14");
if (!databasePath || !backupDirectory) {
  throw new Error("DATABASE_PATH and BACKUP_DIRECTORY are required");
}
if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
  throw new Error("BACKUP_RETENTION_DAYS must be a positive integer");
}

mkdirSync(backupDirectory, { recursive: true });
const destination = resolve(backupDirectory, `runs-${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
rmSync(destination, { force: true });
const quotedDestination = destination.replaceAll("'", "''");
const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  database.exec(`VACUUM INTO '${quotedDestination}'`);
} finally {
  database.close();
}
const oldestAllowed = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const entry of readdirSync(backupDirectory)) {
  if (!/^runs-.*\.sqlite$/.test(entry)) continue;
  const candidate = resolve(backupDirectory, entry);
  if (statSync(candidate).mtimeMs < oldestAllowed) rmSync(candidate, { force: true });
}
process.stdout.write(`${destination}\n`);
