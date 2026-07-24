import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const usage = "Usage: node deployment/provision-secrets.mjs [--env-file deployment/.env] [--public-key-file path] [--key-id receipt-YYYY-MM]";

const parseArgs = (argv) => {
  const options = { envFile: "deployment/.env", keyId: `receipt-${new Date().toISOString().slice(0, 7)}` };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--env-file") options.envFile = argv[++index] ?? "";
    else if (argument === "--public-key-file") options.publicKeyFile = argv[++index] ?? "";
    else if (argument === "--key-id") options.keyId = argv[++index] ?? "";
    else throw new Error(`${usage}\nUnknown argument: ${argument}`);
  }
  if (!options.envFile || !options.keyId || !/^[A-Za-z0-9._-]+$/.test(options.keyId)) throw new Error(`${usage}\nkey id must contain only letters, digits, dots, underscores, or hyphens`);
  return options;
};

const setEnv = (source, name, value) => {
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
};

export const provision = ({ envFile, publicKeyFile, keyId }) => {
  const envPath = resolve(envFile);
  if (!existsSync(envPath)) throw new Error(`Create ${envFile} from deployment/.env.example before provisioning secrets.`);
  chmodSync(envPath, 0o600);
  const source = readFileSync(envPath, "utf8");
  const names = ["PROOF_RUNNER_BEARER_TOKEN", "PROOF_RUNNER_RECEIPT_PRIVATE_KEY"];
  if (names.some((name) => new RegExp(`^${name}=.+$`, "m").test(source))) {
    throw new Error(`${envFile} already contains provisioned secrets. Refusing to overwrite them; use a dedicated rotation procedure that preserves the old public key.`);
  }
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicPath = resolve(publicKeyFile ?? `${dirname(envPath)}/receipt-public-key-${keyId}.pem`);
  if (existsSync(publicPath)) throw new Error(`${publicPath} already exists. Refusing to overwrite it.`);
  let rendered = source;
  rendered = setEnv(rendered, "PROOF_RUNNER_BEARER_TOKEN", randomBytes(48).toString("base64url"));
  rendered = setEnv(rendered, "PROOF_RUNNER_RECEIPT_KEY_ID", keyId);
  rendered = setEnv(rendered, "PROOF_RUNNER_RECEIPT_PRIVATE_KEY", privateKey);
  writeFileSync(envPath, rendered, { encoding: "utf8", mode: 0o600 });
  chmodSync(envPath, 0o600);
  writeFileSync(publicPath, publicKey, { encoding: "utf8", mode: 0o644 });
  return { envPath, publicPath, keyId };
};

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    }
    const result = provision(options);
    process.stdout.write(`Provisioned deployment secrets in ${result.envPath}\nPublic receipt key: ${result.publicPath}\nKey ID: ${result.keyId}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
