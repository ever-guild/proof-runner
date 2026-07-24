# Production deployment

This Compose topology publishes only the Caddy edge. The API, web origin, and
runner are on an internal Docker network; the runner has no published port.
Run it only on the dedicated worker host required by PR-011. Its Docker socket
is deliberately available to the runner control plane so it can create the
disposable sandbox containers, but is never mounted into a sandbox.

## Provisioning

Before startup, the deployment owner must confirm the domain/DNS/certificate
ownership and inject these values from the host secret manager or a host-only
`deployment/.env` file:

- `PROOF_RUNNER_BEARER_TOKEN`: a new random value of at least 32 characters;
- `PROOF_RUNNER_RECEIPT_PRIVATE_KEY`: dedicated Ed25519 receipt key, never a
  wallet key;
- `PROOF_RUNNER_RECEIPT_KEY_ID` and any retained public verification keys;
- `PROOF_RUNNER_DOMAIN`: the public DNS name.
- `PROOF_RUNNER_BACKUP_PATH`: an encrypted, provider-retained host path outside
  the Docker volume; it is mounted only by the backup service.

Do not put any of those values in Git, container images, an issue, or logs.
Build the untrusted-job runtime image on that same Docker engine before the
runner starts:

```sh
docker build --tag proof-runner-node:1 \
  --file apps/runner/docker/Dockerfile apps/runner/docker
docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --build
```

The runner image supplies its immutable skill and sandbox configuration through
a read-only Docker volume shared with its disposable sibling containers. This
avoids bind mounts from the runner container filesystem, which are not visible
to the host Docker daemon. Do not override
`PROOF_RUNNER_DOCKER_ASSET_CONTAINER=self` unless the replacement names the
runner container on that same daemon.

The API alone also joins an un-published egress network so inspection can fetch
public GitHub metadata; the runner and every build/test sandbox remain on the
private network except for the short-lived allowlisted proxy during clone and
dependency installation. The Caddy edge obtains HTTPS certificates automatically after public DNS for
`PROOF_RUNNER_DOMAIN` points to the host. For a separate API/runner host, keep
the runner private and replace `http://runner:8788` and `http://api:8787` with
the private service DNS names; no internal endpoint may be internet-routable.

## Health, persistence, and backup

`/health/live` proves process liveness; `/health/ready` proves API SQLite
access. The API volume `proof_runner_data` is the durable source for run
metadata, normalized checks, and receipts. Verify a restart before release:

```sh
curl --fail --silent --show-error https://"$PROOF_RUNNER_DOMAIN"/health/ready
docker compose --env-file deployment/.env -f deployment/compose.yaml restart api
curl --fail --silent --show-error https://"$PROOF_RUNNER_DOMAIN"/health/ready
```

The `backup` service creates a consistent SQLite snapshot every 24 hours by
default and keeps fourteen days by default. Its output is written to the
separate host/provider path in `PROOF_RUNNER_BACKUP_PATH`, not to the database
volume. To take one manually:

```sh
docker compose --env-file deployment/.env -f deployment/compose.yaml exec \
  -e DATABASE_PATH=/var/lib/proof-runner/runs.sqlite \
  -e BACKUP_DIRECTORY=/backups backup \
  node /usr/local/bin/backup-sqlite.mjs
```

Exercise restoration on a stopped staging API before release: copy one backup
into the staging `proof_runner_data` volume as `runs.sqlite`, start the API,
then check `/health/ready` and retrieve a known run and receipt. Never restore
over the production volume without a provider snapshot and an approved change.

## Release and ASP evidence

The frozen free-mode A2MCP samples are in [`samples/`](samples/). Publish them
at the deployed domain with the exact endpoint paths `/a2mcp/inspect_repository`
and `/a2mcp/verify_repository`; the latter carries `idempotencyKey` in its JSON
body and returns HTTP 200 in free mode. The lower-level `/api/verify` workflow
continues to use an `Idempotency-Key` header and returns 202 for a new run. Paid mode is not
enabled by this deployment and must not be advertised or registered until the
official OKX Payment SDK integration and paid-replay evidence exist.

Before registering the ASP, record only non-secret evidence: public base URL,
health probes, sample request/response URLs, Agent ID, review email owner, and
submission timestamp. PR-011 owns credential/wallet confirmation; without its
reviewed evidence, deployment and registration remain blocked.
