import {
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import {
  closeSync,
  chmodSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConfiguration,
  initialize,
  parseArgs,
  parseDotenv,
  validateConfiguration,
} from "../provision-secrets.mjs";

const createProductionEnv = () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-secrets-"));
  const envFile = join(directory, ".env.production");
  const publicKeyFile = join(directory, "receipt-public.pem");
  const initialized = initialize({
    outputFile: envFile,
    publicKeyFile,
    keyId: "receipt-test-1",
  });
  const source = readFileSync(envFile, "utf8").replace(
    'PROOF_RUNNER_DOMAIN=""',
    'PROOF_RUNNER_DOMAIN="runner.everguild.dev"',
  ).replace(
    'PROOF_RUNNER_RUNTIME_IMAGE=""',
    `PROOF_RUNNER_RUNTIME_IMAGE="sha256:${"a".repeat(64)}"`,
  );
  writeFileSync(envFile, source, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  return { directory, envFile, publicKeyFile, initialized };
};

const enablePaidMode = (source) => source
  .replace('OKX_API_KEY=""', 'OKX_API_KEY="api-key-value"')
  .replace('OKX_SECRET_KEY=""', 'OKX_SECRET_KEY="secret-key-value"')
  .replace('OKX_PASSPHRASE=""', 'OKX_PASSPHRASE="passphrase-value"')
  .replace('PAY_TO_ADDRESS=""', 'PAY_TO_ADDRESS="0x1111111111111111111111111111111111111111"')
  .replace('PROOF_RUNNER_PAYMENT_MODE="free"', 'PROOF_RUNNER_PAYMENT_MODE="paid"');

const successfulRunner = (calls, failure) => (command, args, options = {}) => {
  calls.push({ command, args, input: options.input });
  const name = args[2];
  if (failure?.({ command, args, name, options })) return { status: 1, stderr: "redacted" };
  return { status: 0, stdout: "" };
};

const productionFileOps = (overrides = {}) => ({
  close: closeSync,
  chmod: chmodSync,
  exists: existsSync,
  fsync: fsyncSync,
  open: openSync,
  unlink: unlinkSync,
  write: writeFileSync,
  ...overrides,
});

test("init creates exclusive files with safe modes, a 48-byte token, and matching Ed25519 keys", () => {
  const { envFile, publicKeyFile, initialized } = createProductionEnv();
  const environment = parseDotenv(readFileSync(envFile, "utf8"));
  const tokenBytes = Buffer.from(environment.PROOF_RUNNER_BEARER_TOKEN, "base64url");
  const privateKey = createPrivateKey(environment.PROOF_RUNNER_RECEIPT_PRIVATE_KEY);
  const publicKey = createPublicKey(readFileSync(publicKeyFile, "utf8"));
  const derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" });

  assert.deepEqual(Object.keys(environment), [
    "PROOF_RUNNER_DOMAIN",
    "PROOF_RUNNER_BEARER_TOKEN",
    "PROOF_RUNNER_RECEIPT_PRIVATE_KEY",
    "PROOF_RUNNER_RECEIPT_KEY_ID",
    "PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS",
    "PROOF_RUNNER_BACKUP_PATH",
    "PROOF_RUNNER_BACKUP_RETENTION_DAYS",
    "PROOF_RUNNER_BACKUP_INTERVAL_SECONDS",
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
    "OKX_API_KEY",
    "OKX_SECRET_KEY",
    "OKX_PASSPHRASE",
    "OKX_BASE_URL",
    "PAY_TO_ADDRESS",
    "PROOF_RUNNER_PAYMENT_NETWORK",
    "PROOF_RUNNER_VERIFY_PRICE",
    "PROOF_RUNNER_PAYMENT_MODE",
  ]);
  assert.equal(tokenBytes.length, 48);
  assert.equal(privateKey.asymmetricKeyType, "ed25519");
  assert.equal(publicKey.asymmetricKeyType, "ed25519");
  assert.deepEqual(publicKey.export({ type: "spki", format: "der" }), derivedPublic);
  assert.equal(statSync(envFile).mode & 0o777, 0o600);
  assert.equal(statSync(publicKeyFile).mode & 0o777, 0o644);
  assert.equal(initialized.keyId, "receipt-test-1");
  assert.equal(environment.PROOF_RUNNER_PAYMENT_MODE, "free");
  assert.equal(environment.OKX_API_KEY, "");
  assert.equal(environment.OKX_SECRET_KEY, "");
  assert.equal(environment.OKX_PASSPHRASE, "");
  assert.equal(environment.PAY_TO_ADDRESS, "");
  assert.equal(environment.OKX_BASE_URL, "https://web3.okx.com");
  assert.equal(environment.PROOF_RUNNER_PAYMENT_NETWORK, "eip155:196");
  assert.equal(environment.PROOF_RUNNER_VERIFY_PRICE, "$0.01");
  assert.equal(environment.PROOF_RUNNER_EXECUTION_MS, "180000");
  assert.equal(environment.PROOF_RUNNER_MEMORY_BYTES, "536870912");
  assert.match(environment.PROOF_RUNNER_RUNTIME_IMAGE, /^sha256:[a-f0-9]{64}$/);
  assert.match(environment.PROOF_RUNNER_PROXY_IMAGE, /@sha256:[a-f0-9]{64}$/);
  assert.throws(
    () => initialize({ outputFile: envFile, publicKeyFile, keyId: "receipt-test-2" }),
    /Refusing to overwrite existing env file/,
  );
});

test("init leaves every operator-owned production value unfilled", () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-secrets-"));
  const envFile = join(directory, ".env.production");
  const publicKeyFile = join(directory, "receipt-public.pem");
  initialize({ outputFile: envFile, publicKeyFile, keyId: "receipt-test-raw" });
  const environment = parseDotenv(readFileSync(envFile, "utf8"));
  assert.equal(environment.PROOF_RUNNER_DOMAIN, "");
  assert.equal(environment.PROOF_RUNNER_RUNTIME_IMAGE, "");
  assert.equal(environment.OKX_API_KEY, "");
  assert.equal(environment.OKX_SECRET_KEY, "");
  assert.equal(environment.OKX_PASSPHRASE, "");
  assert.equal(environment.PAY_TO_ADDRESS, "");
});

test("init rejects a public-key path that would collide with the env file", () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-secrets-"));
  const envFile = join(directory, ".env.production");
  assert.throws(
    () => initialize({ outputFile: envFile, publicKeyFile: envFile, keyId: "receipt-test-1" }),
    /must differ from the env file/,
  );
  assert.throws(() => statSync(envFile));
});

test("init removes both files it created when a post-create chmod fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-secrets-"));
  const envFile = join(directory, ".env.production");
  const publicKeyFile = join(directory, "receipt-public.pem");
  const removed = [];
  const chmodFailure = new Error("forced chmod failure");
  const fileOps = productionFileOps({
    chmod: (path, mode) => {
      if (path === publicKeyFile) throw chmodFailure;
      chmodSync(path, mode);
    },
    unlink: (path) => {
      removed.push(path);
      unlinkSync(path);
    },
  });

  assert.throws(
    () => initialize({ outputFile: envFile, publicKeyFile, keyId: "receipt-test-1", fileOps }),
    (error) => error === chmodFailure,
  );
  assert.deepEqual(removed, [envFile, publicKeyFile]);
  assert.equal(existsSync(envFile), false);
  assert.equal(existsSync(publicKeyFile), false);
});

test("init removes partial secret output after an exclusive env open succeeds", () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-secrets-"));
  const envFile = join(directory, ".env.production");
  const publicKeyFile = join(directory, "receipt-public.pem");
  const writeFailure = new Error("partial secret write failed");
  const removed = [];
  let envDescriptor;
  const fileOps = productionFileOps({
    open: (path, flags, mode) => {
      const descriptor = openSync(path, flags, mode);
      if (path === envFile) envDescriptor = descriptor;
      return descriptor;
    },
    write: (descriptor, content, encoding) => {
      if (descriptor === envDescriptor) {
        writeFileSync(descriptor, content.slice(0, 32), encoding);
        throw writeFailure;
      }
      writeFileSync(descriptor, content, encoding);
    },
    unlink: (path) => {
      removed.push(path);
      unlinkSync(path);
    },
  });

  assert.throws(
    () => initialize({ outputFile: envFile, publicKeyFile, keyId: "receipt-test-1", fileOps }),
    (error) => error === writeFailure,
  );
  assert.deepEqual(removed, [envFile, publicKeyFile]);
  assert.equal(existsSync(envFile), false);
  assert.equal(existsSync(publicKeyFile), false);
});

test("init preserves a foreign file when its exclusive env open fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-secrets-"));
  const envFile = join(directory, ".env.production");
  const publicKeyFile = join(directory, "receipt-public.pem");
  writeFileSync(envFile, "foreign file", { encoding: "utf8", flag: "wx" });
  const removed = [];
  let envOpenAttempts = 0;
  const fileOps = productionFileOps({
    exists: (path) => path !== envFile && existsSync(path),
    open: (path, flags, mode) => {
      if (path === envFile) envOpenAttempts += 1;
      return openSync(path, flags, mode);
    },
    unlink: (path) => {
      removed.push(path);
      unlinkSync(path);
    },
  });

  assert.throws(
    () => initialize({ outputFile: envFile, publicKeyFile, keyId: "receipt-test-1", fileOps }),
    (error) => error?.code === "EEXIST",
  );
  assert.equal(envOpenAttempts, 1);
  assert.deepEqual(removed, [publicKeyFile]);
  assert.equal(readFileSync(envFile, "utf8"), "foreign file");
});

test("init preserves the original error when close and cleanup fail", () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-secrets-"));
  const envFile = join(directory, ".env.production");
  const publicKeyFile = join(directory, "receipt-public.pem");
  const writeFailure = new Error("partial secret write failed");
  const removed = [];
  let envDescriptor;
  const fileOps = productionFileOps({
    open: (path, flags, mode) => {
      const descriptor = openSync(path, flags, mode);
      if (path === envFile) envDescriptor = descriptor;
      return descriptor;
    },
    write: (descriptor, content, encoding) => {
      if (descriptor === envDescriptor) {
        writeFileSync(descriptor, content.slice(0, 32), encoding);
        throw writeFailure;
      }
      writeFileSync(descriptor, content, encoding);
    },
    close: (descriptor) => {
      if (descriptor === envDescriptor) throw new Error("forced close failure");
      closeSync(descriptor);
    },
    unlink: (path) => {
      removed.push(path);
      throw new Error("forced unlink failure");
    },
  });

  assert.throws(
    () => initialize({ outputFile: envFile, publicKeyFile, keyId: "receipt-test-1", fileOps }),
    (error) => error === writeFailure,
  );
  assert.deepEqual(removed, [envFile, publicKeyFile]);
});

test("dotenv parser supports escaped and literal multiline PEM values", () => {
  const escaped = parseDotenv('PROOF_RUNNER_RECEIPT_PRIVATE_KEY="line 1\\nline 2"\n');
  const literal = parseDotenv('PROOF_RUNNER_RECEIPT_PRIVATE_KEY="line 1\nline 2"\n');
  assert.equal(escaped.PROOF_RUNNER_RECEIPT_PRIVATE_KEY, "line 1\nline 2");
  assert.equal(literal.PROOF_RUNNER_RECEIPT_PRIVATE_KEY, "line 1\nline 2");
});

test("dotenv parser rejects duplicate and unknown parameters without showing values", () => {
  assert.throws(
    () => parseDotenv("PROOF_RUNNER_DOMAIN=a\nPROOF_RUNNER_DOMAIN=b\n"),
    /Duplicate dotenv parameter: PROOF_RUNNER_DOMAIN/,
  );
  assert.throws(
    () => parseDotenv("UNRECOGNIZED_SECRET=do-not-print\n"),
    (error) => (
      error.message === "Unknown dotenv parameter: UNRECOGNIZED_SECRET"
      && !error.message.includes("do-not-print")
    ),
  );
});

test("apply requires explicit repository and environment arguments", () => {
  assert.throws(
    () => parseArgs(["apply", "--repo", "ever-guild/proof-runner"]),
    /explicit --environment/,
  );
  assert.throws(
    () => parseArgs(["apply", "--environment", "production"]),
    /explicit --repo/,
  );
  assert.deepEqual(
    parseArgs([
      "apply",
      "--repo",
      "ever-guild/proof-runner",
      "--environment",
      "production",
      "--input-file",
      "deployment/production.env",
    ]),
    {
      command: "apply",
      inputFile: "deployment/production.env",
      repo: "ever-guild/proof-runner",
      environment: "production",
    },
  );
  assert.deepEqual(
    parseArgs(["init", "--output-file", "deployment/production.env"]),
    { command: "init", outputFile: "deployment/production.env" },
  );
  assert.throws(() => parseArgs(["init", "--env-file", "deployment/production.env"]), /Unknown argument/);
  assert.throws(() => parseArgs(["apply", "--env-file", "deployment/production.env"]), /Unknown argument/);
});

test("CLI direct entry runs under the supported Node invocation path", () => {
  const script = fileURLToPath(new URL("../provision-secrets.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stderr, "");
});

test("local validation failure makes zero gh calls", () => {
  const { envFile } = createProductionEnv();
  const source = readFileSync(envFile, "utf8").replace(
    'PROOF_RUNNER_DOMAIN="runner.everguild.dev"',
    'PROOF_RUNNER_DOMAIN="proofrunner.example.com"',
  );
  writeFileSync(envFile, source, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "ever-guild/proof-runner",
      environment: "production",
      inputFile: envFile,
      runCommand: successfulRunner(calls),
    }),
    /must be a real DNS hostname/,
  );
  assert.equal(calls.length, 0);
});

test("free mode rejects accidental OKX credentials before any gh call", () => {
  const { envFile } = createProductionEnv();
  const source = readFileSync(envFile, "utf8").replace(
    'OKX_API_KEY=""',
    'OKX_API_KEY="must-not-be-used-in-free-mode"',
  );
  writeFileSync(envFile, source, { mode: 0o600 });
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "ever-guild/proof-runner",
      environment: "production",
      inputFile: envFile,
      runCommand: successfulRunner(calls),
    }),
    /OKX_API_KEY must be empty in free mode/,
  );
  assert.equal(calls.length, 0);
});

test("paid mode requires the complete OKX credential and receiving-address set", () => {
  const { envFile } = createProductionEnv();
  const freeValues = parseDotenv(readFileSync(envFile, "utf8"));
  assert.throws(
    () => validateConfiguration({ ...freeValues, PROOF_RUNNER_PAYMENT_MODE: "paid" }),
    /OKX_API_KEY is required/,
  );
  assert.throws(
    () => validateConfiguration({
      ...freeValues,
      PROOF_RUNNER_PAYMENT_MODE: "paid",
      OKX_API_KEY: "api-key",
      OKX_SECRET_KEY: "secret-key",
      OKX_PASSPHRASE: "passphrase",
      PAY_TO_ADDRESS: "not-an-address",
    }),
    /PAY_TO_ADDRESS must be a 20-byte EVM address/,
  );
  const paidValues = parseDotenv(enablePaidMode(readFileSync(envFile, "utf8")));
  assert.equal(validateConfiguration(paidValues), paidValues);
});

test("validation rejects an incomplete legacy production schema", () => {
  const { envFile } = createProductionEnv();
  const values = parseDotenv(readFileSync(envFile, "utf8"));
  delete values.OKX_API_KEY;
  assert.throws(
    () => validateConfiguration(values),
    /OKX_API_KEY parameter is required/,
  );
});

test("runner policy rejects unsafe images, excessive timeout, and undersized disk", () => {
  const { envFile } = createProductionEnv();
  const values = parseDotenv(readFileSync(envFile, "utf8"));
  assert.throws(
    () => validateConfiguration({ ...values, PROOF_RUNNER_RUNTIME_IMAGE: "" }),
    /PROOF_RUNNER_RUNTIME_IMAGE is required/,
  );
  assert.throws(
    () => validateConfiguration({ ...values, PROOF_RUNNER_RUNTIME_IMAGE: "proof-runner-node:1" }),
    /pinned by sha256 image ID or repository digest/,
  );
  assert.equal(
    validateConfiguration({
      ...values,
      PROOF_RUNNER_RUNTIME_IMAGE: `registry.example/proof-runner@sha256:${"b".repeat(64)}`,
    }).PROOF_RUNNER_RUNTIME_IMAGE,
    `registry.example/proof-runner@sha256:${"b".repeat(64)}`,
  );
  assert.throws(
    () => validateConfiguration({ ...values, PROOF_RUNNER_PROXY_IMAGE: "ubuntu/squid:latest" }),
    /pinned by sha256 digest/,
  );
  assert.throws(
    () => validateConfiguration({ ...values, PROOF_RUNNER_EXECUTION_MS: "180001" }),
    /between 1000 and 180000/,
  );
  assert.throws(
    () => validateConfiguration({ ...values, PROOF_RUNNER_DISK_BYTES: "16777216" }),
    /must be at least PROOF_RUNNER_REPOSITORY_BYTES/,
  );
});

test("unsafe env file permissions make zero gh calls", () => {
  const { envFile } = createProductionEnv();
  chmodSync(envFile, 0o640);
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "ever-guild/proof-runner",
      environment: "production",
      inputFile: envFile,
      runCommand: successfulRunner(calls),
    }),
    /permissions are unsafe/,
  );
  assert.equal(calls.length, 0);
});

test("dry-run validates and reports the target and allowlisted names without gh", () => {
  const { envFile } = createProductionEnv();
  const calls = [];
  const result = applyConfiguration({
    repo: "ever-guild/proof-runner",
    environment: "production-eu",
    inputFile: envFile,
    dryRun: true,
    runCommand: successfulRunner(calls),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.repo, "ever-guild/proof-runner");
  assert.equal(result.environment, "production-eu");
  assert.deepEqual(result.secrets, [
    "PROOF_RUNNER_BEARER_TOKEN",
    "PROOF_RUNNER_RECEIPT_PRIVATE_KEY",
  ]);
  assert.ok(result.variables.includes("PROOF_RUNNER_DOMAIN"));
  assert.ok(result.variables.includes("PROOF_RUNNER_PAYMENT_MODE"));
  assert.ok(result.variables.includes("PROOF_RUNNER_EXECUTION_MS"));
  assert.ok(!result.variables.includes("PAY_TO_ADDRESS"));
});

test("apply preflights, creates the requested Environment, and sends every value through stdin", () => {
  const { envFile } = createProductionEnv();
  const expected = parseDotenv(readFileSync(envFile, "utf8"));
  const calls = [];
  const result = applyConfiguration({
    repo: "ever-guild/proof-runner",
    environment: "production-eu",
    inputFile: envFile,
    runCommand: successfulRunner(calls),
  });

  assert.deepEqual(calls.slice(0, 3).map(({ args }) => args), [
    ["--version"],
    ["auth", "status"],
    ["repo", "view", "ever-guild/proof-runner", "--json", "nameWithOwner"],
  ]);
  assert.deepEqual(calls[3].args, [
    "api",
    "--paginate",
    "repos/ever-guild/proof-runner/environments",
    "--jq",
    ".environments[].name",
  ]);
  assert.deepEqual(calls[4].args, [
    "api",
    "--method",
    "PUT",
    "repos/ever-guild/proof-runner/environments/production-eu",
  ]);
  const expectedOrder = [
    ["secret", "PROOF_RUNNER_BEARER_TOKEN"],
    ["variable", "PROOF_RUNNER_RECEIPT_KEY_ID"],
    ["variable", "PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS"],
    ["secret", "PROOF_RUNNER_RECEIPT_PRIVATE_KEY"],
    ["variable", "PROOF_RUNNER_DOMAIN"],
    ["variable", "PROOF_RUNNER_BACKUP_PATH"],
    ["variable", "PROOF_RUNNER_BACKUP_RETENTION_DAYS"],
    ["variable", "PROOF_RUNNER_BACKUP_INTERVAL_SECONDS"],
    ["variable", "PROOF_RUNNER_RUNTIME_IMAGE"],
    ["variable", "PROOF_RUNNER_PROXY_IMAGE"],
    ["variable", "PROOF_RUNNER_LEASE_EXTENSION_MS"],
    ["variable", "PROOF_RUNNER_REPOSITORY_BYTES"],
    ["variable", "PROOF_RUNNER_FILE_COUNT"],
    ["variable", "PROOF_RUNNER_DISK_BYTES"],
    ["variable", "PROOF_RUNNER_CPU_COUNT"],
    ["variable", "PROOF_RUNNER_MEMORY_BYTES"],
    ["variable", "PROOF_RUNNER_PIDS"],
    ["variable", "PROOF_RUNNER_EXECUTION_MS"],
    ["variable", "PROOF_RUNNER_OUTPUT_BYTES"],
    ["variable", "OKX_BASE_URL"],
    ["variable", "PROOF_RUNNER_PAYMENT_NETWORK"],
    ["variable", "PROOF_RUNNER_VERIFY_PRICE"],
    ["variable", "PROOF_RUNNER_PAYMENT_MODE"],
  ];
  const mutations = calls.filter(({ args }) => (
    (args[0] === "secret" || args[0] === "variable") && args[1] === "set"
  ));
  assert.deepEqual(mutations.map(({ args }) => [args[0], args[2]]), expectedOrder);
  for (const call of mutations) {
    const name = call.args[2];
    assert.deepEqual(call.args.slice(3), [
      "--repo",
      "ever-guild/proof-runner",
      "--env",
      "production-eu",
    ]);
    assert.equal(call.input, expected[name]);
    assert.ok(!call.args.includes(expected[name]));
  }
  assert.equal(result.applied.length, expectedOrder.length);
  assert.equal(result.environment, "production-eu");
});

test("paid apply sends OKX credentials through stdin and switches mode last", () => {
  const { envFile } = createProductionEnv();
  const paidSource = enablePaidMode(readFileSync(envFile, "utf8"));
  writeFileSync(envFile, paidSource, { mode: 0o600 });
  const expected = parseDotenv(paidSource);
  const calls = [];
  const result = applyConfiguration({
    repo: "ever-guild/proof-runner",
    environment: "production",
    inputFile: envFile,
    runCommand: successfulRunner(calls),
  });
  const mutations = calls.filter(({ args }) => (
    args[0] === "secret" || args[0] === "variable"
  ));
  assert.deepEqual(
    mutations.slice(-5).map(({ args }) => [args[0], args[2]]),
    [
      ["secret", "OKX_API_KEY"],
      ["secret", "OKX_SECRET_KEY"],
      ["secret", "OKX_PASSPHRASE"],
      ["variable", "PAY_TO_ADDRESS"],
      ["variable", "PROOF_RUNNER_PAYMENT_MODE"],
    ],
  );
  for (const call of mutations) {
    const name = call.args[2];
    assert.equal(call.input, expected[name]);
    assert.ok(!call.args.includes(expected[name]));
  }
  assert.deepEqual(result.secrets.slice(-3), [
    "OKX_API_KEY",
    "OKX_SECRET_KEY",
    "OKX_PASSPHRASE",
  ]);
  assert.ok(result.variables.includes("PAY_TO_ADDRESS"));
});

test("free apply removes stale paid values before switching payment mode", () => {
  const { envFile } = createProductionEnv();
  const calls = [];
  const runCommand = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (args[0] === "secret" && args[1] === "list") {
      return { status: 0, stdout: "OKX_API_KEY\nOKX_SECRET_KEY\nOKX_PASSPHRASE\n" };
    }
    if (args[0] === "variable" && args[1] === "list") {
      return { status: 0, stdout: "PAY_TO_ADDRESS\nPROOF_RUNNER_PAYMENT_MODE\n" };
    }
    return { status: 0, stdout: "" };
  };
  const result = applyConfiguration({
    repo: "ever-guild/proof-runner",
    environment: "production",
    inputFile: envFile,
    runCommand,
  });
  const remoteMutations = calls.filter(({ args }) => (
    (args[0] === "secret" || args[0] === "variable")
    && (args[1] === "set" || args[1] === "delete")
  ));
  assert.deepEqual(
    remoteMutations.slice(-5).map(({ args }) => [args[0], args[1], args[2]]),
    [
      ["secret", "delete", "OKX_API_KEY"],
      ["secret", "delete", "OKX_SECRET_KEY"],
      ["secret", "delete", "OKX_PASSPHRASE"],
      ["variable", "delete", "PAY_TO_ADDRESS"],
      ["variable", "set", "PROOF_RUNNER_PAYMENT_MODE"],
    ],
  );
  assert.deepEqual(result.removed, [
    "OKX_API_KEY",
    "OKX_SECRET_KEY",
    "OKX_PASSPHRASE",
    "PAY_TO_ADDRESS",
  ]);
});

test("apply preserves an existing Environment and its protections", () => {
  const { envFile } = createProductionEnv();
  const calls = [];
  const runCommand = (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    if (args[0] === "api" && args.includes("--paginate")) {
      return { status: 0, stdout: "Production-EU\nproduction\n" };
    }
    return { status: 0, stdout: "" };
  };
  const result = applyConfiguration({
    repo: "ever-guild/proof-runner",
    environment: "production-eu",
    inputFile: envFile,
    runCommand,
  });
  assert.ok(calls.some(({ args }) => args.includes("--paginate")));
  assert.equal(calls.some(({ args }) => args[0] === "api" && args.includes("PUT")), false);
  assert.equal(result.environment, "Production-EU");
  for (const { args } of calls.filter(({ args }) => (
    (args[0] === "secret" || args[0] === "variable")
    && (args[1] === "set" || args[1] === "delete")
  ))) {
    assert.equal(args.at(-1), "Production-EU");
  }
});

test("failed Environment listing stops before any remote mutation", () => {
  const { envFile } = createProductionEnv();
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "ever-guild/proof-runner",
      environment: "production-eu",
      inputFile: envFile,
      runCommand: successfulRunner(
        calls,
        ({ args }) => args[0] === "api" && args.includes("--paginate"),
      ),
    }),
    /Failed to list GitHub Environments/,
  );
  assert.equal(calls.some(({ args }) => args.includes("PUT")), false);
  assert.equal(calls.some(({ args }) => args[0] === "secret" || args[0] === "variable"), false);
});

test("failed gh authentication stops before repository or Environment mutation", () => {
  const { envFile } = createProductionEnv();
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "ever-guild/proof-runner",
      environment: "production",
      inputFile: envFile,
      runCommand: successfulRunner(calls, ({ args }) => args[0] === "auth"),
    }),
    /authentication check failed/,
  );
  assert.deepEqual(calls.map(({ args }) => args), [
    ["--version"],
    ["auth", "status"],
  ]);
});

test("partial remote failure reports parameter names but never values", () => {
  const { envFile } = createProductionEnv();
  const values = parseDotenv(readFileSync(envFile, "utf8"));
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "ever-guild/proof-runner",
      environment: "production",
      inputFile: envFile,
      runCommand: successfulRunner(
        calls,
        ({ args }) => args[0] === "variable" && args[2] === "PROOF_RUNNER_RECEIPT_KEY_ID",
      ),
    }),
    (error) => {
      assert.match(error.message, /Failed to apply PROOF_RUNNER_RECEIPT_KEY_ID/);
      assert.match(error.message, /PROOF_RUNNER_BEARER_TOKEN/);
      for (const value of Object.values(values)) {
        if (value.length >= 8) assert.ok(!error.message.includes(value));
      }
      return true;
    },
  );
});

test("invalid repo target is rejected before reading or invoking gh", () => {
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "implicit",
      environment: "production",
      inputFile: "/does/not/matter",
      runCommand: successfulRunner(calls),
    }),
    /explicit owner\/repo/,
  );
  assert.equal(calls.length, 0);
});

test("missing environment is rejected before reading or invoking gh", () => {
  const calls = [];
  assert.throws(
    () => applyConfiguration({
      repo: "ever-guild/proof-runner",
      inputFile: "/does/not/matter",
      runCommand: successfulRunner(calls),
    }),
    /--environment is invalid/,
  );
  assert.equal(calls.length, 0);
});
