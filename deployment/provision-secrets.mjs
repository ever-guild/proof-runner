#!/usr/bin/env node

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import {
  closeSync,
  chmodSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = "deployment/.env.production";
const CORE_SECRET_NAMES = Object.freeze([
  "PROOF_RUNNER_BEARER_TOKEN",
  "PROOF_RUNNER_RECEIPT_PRIVATE_KEY",
]);
const OKX_SECRET_NAMES = Object.freeze([
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_PASSPHRASE",
]);
const SECRET_NAMES = Object.freeze([...CORE_SECRET_NAMES, ...OKX_SECRET_NAMES]);
const VARIABLE_NAMES = Object.freeze([
  "PROOF_RUNNER_DOMAIN",
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
  "OKX_BASE_URL",
  "PAY_TO_ADDRESS",
  "PROOF_RUNNER_PAYMENT_NETWORK",
  "PROOF_RUNNER_VERIFY_PRICE",
  "PROOF_RUNNER_PAYMENT_MODE",
]);
const ALLOWED_NAMES = new Set([...SECRET_NAMES, ...VARIABLE_NAMES]);
const usage = `Usage:
  node deployment/provision-secrets.mjs init [--output-file ${DEFAULT_ENV_FILE}] [--public-key-file path] [--key-id id]
  node deployment/provision-secrets.mjs apply --repo owner/repo --environment production [--input-file ${DEFAULT_ENV_FILE}] [--dry-run]`;

const fail = (message) => {
  throw new Error(message);
};

const readOption = (argv, index, name) => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
};

export const parseArgs = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const command = argv[0];
  if (command !== "init" && command !== "apply") fail(usage);
  const options = { command };
  if (command === "init") options.outputFile = DEFAULT_ENV_FILE;
  if (command === "apply") options.inputFile = DEFAULT_ENV_FILE;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (command === "init" && argument === "--output-file") {
      options.outputFile = readOption(argv, index++, argument);
    } else if (command === "apply" && argument === "--input-file") {
      options.inputFile = readOption(argv, index++, argument);
    }
    else if (command === "init" && argument === "--public-key-file") {
      options.publicKeyFile = readOption(argv, index++, argument);
    } else if (command === "init" && argument === "--key-id") {
      options.keyId = readOption(argv, index++, argument);
    } else if (command === "apply" && argument === "--repo") {
      options.repo = readOption(argv, index++, argument);
    } else if (command === "apply" && argument === "--environment") {
      options.environment = readOption(argv, index++, argument);
    } else if (command === "apply" && argument === "--dry-run") {
      options.dryRun = true;
    } else {
      fail(`Unknown argument for ${command}: ${argument}`);
    }
  }
  if (command === "apply" && !options.repo) fail("apply requires an explicit --repo owner/repo");
  if (command === "apply" && !options.environment) {
    fail("apply requires an explicit --environment name");
  }
  return options;
};

const quote = (value) => JSON.stringify(value);
const literalQuote = (value) => `'${value.replace(/'/g, "\\'")}'`;

const defaultKeyId = () => (
  `receipt-${new Date().toISOString().slice(0, 7)}-${randomBytes(4).toString("hex")}`
);

const defaultFileOps = Object.freeze({
  chmod: chmodSync,
  close: closeSync,
  exists: existsSync,
  fsync: fsyncSync,
  open: openSync,
  unlink: unlinkSync,
  write: writeFileSync,
});

export const initialize = ({
  outputFile = DEFAULT_ENV_FILE,
  fileOps = defaultFileOps,
  publicKeyFile,
  keyId = defaultKeyId(),
} = {}) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(keyId)) {
    fail("key id must contain only letters, digits, dots, underscores, or hyphens");
  }
  const envPath = resolve(outputFile);
  const publicPath = resolve(
    publicKeyFile ?? `${envPath}.receipt-public-key-${keyId}.pem`,
  );
  if (publicPath === envPath) fail("Public key file must differ from the env file");
  if (fileOps.exists(envPath)) fail(`Refusing to overwrite existing env file: ${envPath}`);
  if (fileOps.exists(publicPath)) fail(`Refusing to overwrite existing public key file: ${publicPath}`);

  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const verificationKeys = JSON.stringify([{ keyId, publicKeyPem: publicKey }]);
  const values = {
    PROOF_RUNNER_DOMAIN: "",
    PROOF_RUNNER_BEARER_TOKEN: randomBytes(48).toString("base64url"),
    PROOF_RUNNER_RECEIPT_KEY_ID: keyId,
    PROOF_RUNNER_RECEIPT_PRIVATE_KEY: privateKey,
    PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS: verificationKeys,
    PROOF_RUNNER_BACKUP_PATH: "/srv/proof-runner-backups",
    PROOF_RUNNER_BACKUP_RETENTION_DAYS: "14",
    PROOF_RUNNER_BACKUP_INTERVAL_SECONDS: "86400",
    PROOF_RUNNER_RUNTIME_IMAGE: "",
    PROOF_RUNNER_PROXY_IMAGE: "ubuntu/squid@sha256:3de2e64f0ca6efdac3e98557607dc0f23050037f3885016d5d5bfcf9950501b8",
    PROOF_RUNNER_LEASE_EXTENSION_MS: "30000",
    PROOF_RUNNER_REPOSITORY_BYTES: "104857600",
    PROOF_RUNNER_FILE_COUNT: "20000",
    PROOF_RUNNER_DISK_BYTES: "536870912",
    PROOF_RUNNER_CPU_COUNT: "1",
    PROOF_RUNNER_MEMORY_BYTES: "536870912",
    PROOF_RUNNER_PIDS: "128",
    PROOF_RUNNER_EXECUTION_MS: "180000",
    PROOF_RUNNER_OUTPUT_BYTES: "1048576",
    OKX_API_KEY: "",
    OKX_SECRET_KEY: "",
    OKX_PASSPHRASE: "",
    OKX_BASE_URL: "https://web3.okx.com",
    PAY_TO_ADDRESS: "",
    PROOF_RUNNER_PAYMENT_NETWORK: "eip155:196",
    PROOF_RUNNER_VERIFY_PRICE: "$0.01",
    PROOF_RUNNER_PAYMENT_MODE: "free",
  };
  const rendered = [
    "# Generated by deployment/provision-secrets.mjs init.",
    "# Fill PROOF_RUNNER_DOMAIN and PROOF_RUNNER_RUNTIME_IMAGE; review every non-secret setting.",
    "# Free mode leaves OKX credentials and PAY_TO_ADDRESS empty.",
    "# For paid mode, obtain (do not generate) all four values and set PROOF_RUNNER_PAYMENT_MODE=paid.",
    "# Keep operator-provided OKX credentials inside the generated single quotes so Compose preserves dollar signs literally.",
    ...VARIABLE_NAMES.slice(0, 1).map((name) => `${name}=${quote(values[name])}`),
    ...CORE_SECRET_NAMES.map((name) => `${name}=${quote(values[name])}`),
    ...VARIABLE_NAMES.slice(1, 17).map((name) => `${name}=${quote(values[name])}`),
    "",
    "# Official OKX x402 seller inputs. Provisioning these does not enable paid mode in runtime.",
    ...OKX_SECRET_NAMES.map((name) => `${name}=${literalQuote(values[name])}`),
    ...VARIABLE_NAMES.slice(17).map((name) => `${name}=${quote(values[name])}`),
    "",
  ].join("\n");

  let publicCreated = false;
  let envCreated = false;
  const writeExclusive = (path, content, mode, markCreated) => {
    let descriptor;
    let originalError;
    try {
      descriptor = fileOps.open(path, "wx", mode);
      markCreated();
      fileOps.write(descriptor, content, "utf8");
      fileOps.fsync(descriptor);
    } catch (error) {
      originalError = error;
    }
    if (descriptor !== undefined) {
      try {
        fileOps.close(descriptor);
      } catch (error) {
        if (!originalError) originalError = error;
      }
    }
    if (originalError) throw originalError;
  };
  try {
    writeExclusive(publicPath, publicKey, 0o644, () => { publicCreated = true; });
    writeExclusive(envPath, rendered, 0o600, () => { envCreated = true; });
    fileOps.chmod(envPath, 0o600);
    fileOps.chmod(publicPath, 0o644);
  } catch (error) {
    for (const [path, created] of [[envPath, envCreated], [publicPath, publicCreated]]) {
      if (!created) continue;
      try {
        fileOps.unlink(path);
      } catch {
        // Preserve the provisioning error; cleanup is best effort.
      }
    }
    throw error;
  }
  return { envPath, publicPath, keyId };
};

const decodeDoubleQuoted = (source, line) => {
  let output = "";
  for (let index = 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') return { value: output, consumed: index + 1 };
    if (character !== "\\") {
      output += character;
      continue;
    }
    const escaped = source[++index];
    if (escaped === undefined) fail(`Invalid escape at line ${line}`);
    const escapes = { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' };
    output += Object.hasOwn(escapes, escaped) ? escapes[escaped] : `\\${escaped}`;
  }
  fail(`Unterminated quoted value at line ${line}`);
};

const decodeSingleQuoted = (source, line) => {
  let value = "";
  for (let index = 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") return { value, consumed: index + 1 };
    if (character === "\\") {
      const escaped = source[index + 1];
      if (escaped === "'") {
        value += "'";
        index += 1;
        continue;
      }
      if (escaped === "\\") {
        value += "\\\\";
        index += 1;
        continue;
      }
    }
    value += character;
  }
  fail(`Unterminated quoted value at line ${line}`);
};

export const parseDotenv = (source) => {
  const values = {};
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = lines[index].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) fail(`Invalid dotenv declaration at line ${lineNumber}`);
    const [, name] = match;
    if (Object.hasOwn(values, name)) fail(`Duplicate dotenv parameter: ${name}`);
    if (!ALLOWED_NAMES.has(name)) fail(`Unknown dotenv parameter: ${name}`);
    let remainder = match[2];
    let parsed;
    if (remainder.startsWith('"') || remainder.startsWith("'")) {
      const quoteCharacter = remainder[0];
      while (true) {
        try {
          parsed = quoteCharacter === '"'
            ? decodeDoubleQuoted(remainder, lineNumber)
            : decodeSingleQuoted(remainder, lineNumber);
          break;
        } catch (error) {
          if (!String(error.message).startsWith("Unterminated") || index + 1 >= lines.length) {
            throw error;
          }
          remainder += `\n${lines[++index]}`;
        }
      }
      const trailing = remainder.slice(parsed.consumed).trim();
      if (trailing && !trailing.startsWith("#")) {
        fail(`Unexpected content after quoted value at line ${lineNumber}`);
      }
    } else {
      const comment = remainder.search(/\s+#/);
      parsed = { value: (comment === -1 ? remainder : remainder.slice(0, comment)).trim() };
    }
    values[name] = parsed.value;
  }
  return values;
};

const requireValue = (values, name) => {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) fail(`${name} is required`);
  return value;
};

const requireParameter = (values, name) => {
  if (typeof values[name] !== "string") fail(`${name} parameter is required`);
};

const publicDer = (key) => (
  key.type === "public" ? key : createPublicKey(key)
).export({ type: "spki", format: "der" });

export const validateConfiguration = (values) => {
  for (const name of [...SECRET_NAMES, ...VARIABLE_NAMES]) requireParameter(values, name);
  for (const name of [...CORE_SECRET_NAMES, ...VARIABLE_NAMES.filter(
    (name) => name !== "PAY_TO_ADDRESS",
  )]) requireValue(values, name);

  const domain = values.PROOF_RUNNER_DOMAIN;
  const labels = domain.split(".");
  if (
    domain.length > 253
    || domain.includes("://")
    || domain.includes("/")
    || labels.length < 2
    || labels.some((label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
    || labels.some((label) => /^example$/i.test(label))
    || labels.every((label) => /^[0-9]+$/.test(label))
    || /(^|\.)(localhost|local|example|invalid|test)$/i.test(domain)
  ) {
    fail("PROOF_RUNNER_DOMAIN must be a real DNS hostname without a scheme or path");
  }

  const token = values.PROOF_RUNNER_BEARER_TOKEN;
  let tokenBytes;
  try {
    tokenBytes = Buffer.from(token, "base64url");
  } catch {
    tokenBytes = Buffer.alloc(0);
  }
  if (
    token.length < 64
    || !/^[A-Za-z0-9_-]+$/.test(token)
    || tokenBytes.length < 48
    || tokenBytes.toString("base64url") !== token
    || new Set(token).size < 16
  ) {
    fail("PROOF_RUNNER_BEARER_TOKEN must be a strong base64url token of at least 48 bytes");
  }

  const keyId = values.PROOF_RUNNER_RECEIPT_KEY_ID;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(keyId) || /YYYY/i.test(keyId)) {
    fail("PROOF_RUNNER_RECEIPT_KEY_ID is invalid");
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(values.PROOF_RUNNER_RECEIPT_PRIVATE_KEY);
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error();
  } catch {
    fail("PROOF_RUNNER_RECEIPT_PRIVATE_KEY must be a valid Ed25519 private key");
  }

  let verificationKeys;
  try {
    verificationKeys = JSON.parse(values.PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS);
  } catch {
    fail("PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS must be valid JSON");
  }
  if (!Array.isArray(verificationKeys) || verificationKeys.length === 0) {
    fail("PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS must be a non-empty JSON array");
  }
  const seenKeyIds = new Set();
  let activePublicKey;
  for (const entry of verificationKeys) {
    if (
      !entry
      || typeof entry !== "object"
      || typeof entry.keyId !== "string"
      || typeof entry.publicKeyPem !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.keyId)
      || seenKeyIds.has(entry.keyId)
    ) {
      fail("PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS contains an invalid or duplicate entry");
    }
    seenKeyIds.add(entry.keyId);
    try {
      const key = createPublicKey(entry.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") throw new Error();
      if (entry.keyId === keyId) activePublicKey = key;
    } catch {
      fail("PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS must contain valid Ed25519 public keys");
    }
  }
  if (!activePublicKey || !publicDer(activePublicKey).equals(publicDer(privateKey))) {
    fail("PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS must contain the active signing public key");
  }

  const backupPath = values.PROOF_RUNNER_BACKUP_PATH;
  const forbiddenPaths = new Set(["/", "/bin", "/dev", "/etc", "/home", "/proc", "/root", "/sbin", "/sys", "/tmp", "/usr", "/var"]);
  if (
    !isAbsolute(backupPath)
    || normalize(backupPath) !== backupPath
    || forbiddenPaths.has(backupPath)
    || backupPath.includes("\0")
  ) {
    fail("PROOF_RUNNER_BACKUP_PATH must be a normalized, dedicated absolute path");
  }
  const positiveInteger = (name, minimum, maximum) => {
    const value = values[name];
    if (!/^[1-9][0-9]*$/.test(value) || Number(value) < minimum || Number(value) > maximum) {
      fail(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
  };
  positiveInteger("PROOF_RUNNER_BACKUP_RETENTION_DAYS", 1, 3650);
  positiveInteger("PROOF_RUNNER_BACKUP_INTERVAL_SECONDS", 60, 31_536_000);
  const imageComponent = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
  const imageRepository = `${imageComponent}(?:/${imageComponent})*`;
  const imageRegistry = `(?:${imageComponent}(?:\\.${imageComponent})+(?::[0-9]+)?|${imageComponent}:[0-9]+|localhost(?::[0-9]+)?)/`;
  const imageNamePattern = new RegExp(`^(?:${imageRegistry})?${imageRepository}$`);
  const isDigestReference = (value) => {
    const match = /^(.*)@sha256:([a-f0-9]{64})$/.exec(value);
    return Boolean(match && imageNamePattern.test(match[1]));
  };
  const runtimeImage = values.PROOF_RUNNER_RUNTIME_IMAGE;
  if (
    runtimeImage.length > 255
    || !(
      /^sha256:[a-f0-9]{64}$/.test(runtimeImage)
      || isDigestReference(runtimeImage)
    )
  ) {
    fail("PROOF_RUNNER_RUNTIME_IMAGE must be pinned by sha256 image ID or repository digest");
  }
  const proxyImage = values.PROOF_RUNNER_PROXY_IMAGE;
  if (
    proxyImage.length > 255
    || !isDigestReference(proxyImage)
  ) {
    fail("PROOF_RUNNER_PROXY_IMAGE must be pinned by sha256 digest");
  }
  positiveInteger("PROOF_RUNNER_LEASE_EXTENSION_MS", 1_000, 180_000);
  positiveInteger("PROOF_RUNNER_REPOSITORY_BYTES", 1_048_576, 10_737_418_240);
  positiveInteger("PROOF_RUNNER_FILE_COUNT", 1, 1_000_000);
  positiveInteger("PROOF_RUNNER_DISK_BYTES", 16_777_216, 68_719_476_736);
  positiveInteger("PROOF_RUNNER_CPU_COUNT", 1, 64);
  positiveInteger("PROOF_RUNNER_MEMORY_BYTES", 16_777_216, 68_719_476_736);
  positiveInteger("PROOF_RUNNER_PIDS", 16, 32_768);
  positiveInteger("PROOF_RUNNER_EXECUTION_MS", 1_000, 180_000);
  positiveInteger("PROOF_RUNNER_OUTPUT_BYTES", 1_024, 104_857_600);
  if (
    Number(values.PROOF_RUNNER_DISK_BYTES)
    < Number(values.PROOF_RUNNER_REPOSITORY_BYTES)
  ) {
    fail("PROOF_RUNNER_DISK_BYTES must be at least PROOF_RUNNER_REPOSITORY_BYTES");
  }

  const paymentMode = values.PROOF_RUNNER_PAYMENT_MODE;
  if (paymentMode !== "free" && paymentMode !== "paid") {
    fail("PROOF_RUNNER_PAYMENT_MODE must be free or paid");
  }
  let okxBaseUrl;
  try {
    okxBaseUrl = new URL(values.OKX_BASE_URL);
  } catch {
    fail("OKX_BASE_URL must be the official HTTPS facilitator origin");
  }
  if (
    okxBaseUrl.protocol !== "https:"
    || okxBaseUrl.hostname !== "web3.okx.com"
    || okxBaseUrl.port
    || okxBaseUrl.username
    || okxBaseUrl.password
    || okxBaseUrl.pathname !== "/"
    || okxBaseUrl.search
    || okxBaseUrl.hash
  ) {
    fail("OKX_BASE_URL must be the official HTTPS facilitator origin");
  }
  if (!["eip155:196", "eip155:1952"].includes(values.PROOF_RUNNER_PAYMENT_NETWORK)) {
    fail("PROOF_RUNNER_PAYMENT_NETWORK must be an official X Layer network");
  }
  if (!/^\$(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(values.PROOF_RUNNER_VERIFY_PRICE)) {
    fail("PROOF_RUNNER_VERIFY_PRICE must be a USD price such as $0.01");
  }
  const payToAddress = values.PAY_TO_ADDRESS;
  if (paymentMode === "free") {
    for (const name of [...OKX_SECRET_NAMES, "PAY_TO_ADDRESS"]) {
      if (values[name]) fail(`${name} must be empty in free mode`);
    }
  } else {
    for (const name of OKX_SECRET_NAMES) {
      const value = requireValue(values, name);
      if (value.length > 512 || /[\r\n]/.test(value)) {
        fail(`${name} is invalid`);
      }
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(payToAddress)) {
      fail("PAY_TO_ADDRESS must be a 20-byte EVM address in paid mode");
    }
  }
  return values;
};

const defaultRunCommand = (command, args, { input } = {}) => (
  spawnSync(command, args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  })
);

const commandSucceeded = (result) => !result.error && result.status === 0;

const validateTarget = (repo, environment) => {
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail("--repo must be an explicit owner/repo name");
  }
  if (
    typeof environment !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(environment)
  ) {
    fail("--environment is invalid");
  }
};

export const loadConfiguration = (inputFile) => {
  const envPath = resolve(inputFile);
  let metadata;
  try {
    metadata = statSync(envPath);
  } catch {
    fail(`Cannot read env file: ${envPath}`);
  }
  if (!metadata.isFile()) fail(`Env path is not a regular file: ${envPath}`);
  if ((metadata.mode & 0o077) !== 0) {
    fail("Env file permissions are unsafe; remove all group and world access");
  }
  return validateConfiguration(parseDotenv(readFileSync(envPath, "utf8")));
};

export const applyConfiguration = ({
  repo,
  environment,
  inputFile = DEFAULT_ENV_FILE,
  dryRun = false,
  runCommand = defaultRunCommand,
}) => {
  validateTarget(repo, environment);
  const values = loadConfiguration(inputFile);
  const paid = values.PROOF_RUNNER_PAYMENT_MODE === "paid";
  const names = {
    secrets: [...CORE_SECRET_NAMES, ...(paid ? OKX_SECRET_NAMES : [])],
    variables: VARIABLE_NAMES.filter((name) => (
      name !== "PAY_TO_ADDRESS" || paid
    )),
  };
  if (dryRun) return { repo, environment, dryRun: true, applied: [], ...names };

  const version = runCommand("gh", ["--version"]);
  if (version.error?.code === "ENOENT") fail("GitHub CLI is not available");
  if (!commandSucceeded(version)) fail("GitHub CLI availability check failed");
  if (!commandSucceeded(runCommand("gh", ["auth", "status"]))) {
    fail("GitHub CLI authentication check failed");
  }
  if (!commandSucceeded(runCommand("gh", ["repo", "view", repo, "--json", "nameWithOwner"]))) {
    fail(`Repository access preflight failed for ${repo}`);
  }
  const environments = runCommand("gh", [
    "api",
    "--paginate",
    `repos/${repo}/environments`,
    "--jq",
    ".environments[].name",
  ]);
  if (!commandSucceeded(environments)) {
    fail(`Failed to list GitHub Environments for ${repo}`);
  }
  const existingEnvironment = (environments.stdout ?? "")
    .split(/\r?\n/)
    .find((name) => name.toLowerCase() === environment.toLowerCase());
  const targetEnvironment = existingEnvironment || environment;
  if (!existingEnvironment && !commandSucceeded(runCommand("gh", [
    "api",
    "--method",
    "PUT",
    `repos/${repo}/environments/${encodeURIComponent(environment)}`,
  ]))) {
    fail(`Failed to create GitHub Environment ${environment} in ${repo}`);
  }

  const applied = [];
  const removed = [];
  const remoteNames = { secrets: new Set(), variables: new Set() };
  if (!paid) {
    for (const [kind, collection] of [
      ["secret", remoteNames.secrets],
      ["variable", remoteNames.variables],
    ]) {
      const listed = runCommand("gh", [
        kind,
        "list",
        "--repo",
        repo,
        "--env",
        targetEnvironment,
        "--json",
        "name",
        "--jq",
        ".[].name",
      ]);
      if (!commandSucceeded(listed)) {
        fail(`Failed to list existing GitHub Environment ${kind} names`);
      }
      for (const name of (listed.stdout ?? "").split(/\r?\n/).filter(Boolean)) {
        collection.add(name);
      }
    }
  }
  const setValue = (kind, name) => {
    const result = runCommand("gh", [
      kind,
      "set",
      name,
      "--repo",
      repo,
      "--env",
      targetEnvironment,
    ], { input: values[name] });
    if (!commandSucceeded(result)) {
      const completed = applied.length ? applied.join(", ") : "none";
      fail(`Failed to apply ${name}; parameters already applied: ${completed}`);
    }
    applied.push(name);
  };
  const removeValue = (kind, name) => {
    const result = runCommand("gh", [
      kind,
      "delete",
      name,
      "--repo",
      repo,
      "--env",
      targetEnvironment,
    ]);
    if (!commandSucceeded(result)) {
      const completed = removed.length ? removed.join(", ") : "none";
      fail(`Failed to remove ${name}; parameters already removed: ${completed}`);
    }
    removed.push(name);
  };
  const applyPlan = [
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
    ...(paid ? [
      ["secret", "OKX_API_KEY"],
      ["secret", "OKX_SECRET_KEY"],
      ["secret", "OKX_PASSPHRASE"],
      ["variable", "PAY_TO_ADDRESS"],
    ] : []),
    ["variable", "PROOF_RUNNER_PAYMENT_MODE"],
  ];
  for (const [kind, name] of applyPlan) {
    if (!paid && name === "PROOF_RUNNER_PAYMENT_MODE") {
      for (const okxName of OKX_SECRET_NAMES) {
        if (remoteNames.secrets.has(okxName)) removeValue("secret", okxName);
      }
      if (remoteNames.variables.has("PAY_TO_ADDRESS")) {
        removeValue("variable", "PAY_TO_ADDRESS");
      }
    }
    setValue(kind, name);
  }
  return {
    repo,
    environment: targetEnvironment,
    dryRun: false,
    applied,
    removed,
    ...names,
  };
};

const isDirectEntry = () => (
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isDirectEntry()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
    } else if (options.command === "init") {
      const result = initialize(options);
      process.stdout.write(
        `Created production env file: ${result.envPath}\n`
        + `Created public receipt key: ${result.publicPath}\n`
        + `Key ID: ${result.keyId}\n`,
      );
    } else {
      const result = applyConfiguration(options);
      const action = result.dryRun ? "Validated (dry run)" : "Applied";
      process.stdout.write(
        `${action} ${result.repo} environment ${result.environment}\n`
        + `Secrets: ${result.secrets.join(", ")}\n`
        + `Variables: ${result.variables.join(", ")}\n`
        + (result.removed?.length
          ? `Removed stale paid-mode parameters: ${result.removed.join(", ")}\n`
          : ""),
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
