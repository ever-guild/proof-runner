# Isolated runner

The runner accepts the frozen `/internal/v1` contract and executes one leased
run at a time. Every request requires a deployment-scoped bearer token of at
least 32 characters.

## Trust boundary

Each run gets a private, size-limited tmpfs Docker volume and two disposable
Docker networks. The volume's `size` mount option is the hard disk quota; byte
and file-count checks additionally produce stable runner error codes. The job
container can reach only Squid on an internal network during clone and install;
Squid permits GitHub and the npm registry only. The proxy is stopped before
build and test, which run with `--network none`.

The job container is immutable, uses UID/GID `10001`, receives only `HOME`,
`CI`, and phase-specific proxy variables, drops all capabilities, enables
`no-new-privileges`, and has CPU, memory, PID, output, disk, file-count,
repository-size, and wall-clock limits. It does not mount the Docker socket or
any credential path. Cleanup force-removes job/proxy containers, networks, and
the private workspace after every terminal path.

## Build and run

```sh
docker build \
  --tag proof-runner-node:1 \
  --file apps/runner/docker/Dockerfile \
  apps/runner/docker

export PROOF_RUNNER_BEARER_TOKEN="$(openssl rand -hex 32)"
export PROOF_RUNNER_API_URL="https://api.internal.example"
pnpm --filter @ever-guild/proof-runner-runner build
pnpm --filter @ever-guild/proof-runner-runner start
```

## API callbacks

`PROOF_RUNNER_API_URL` is required when starting the runner's HTTP control
plane. It identifies the private API origin where the runner sends leased
heartbeats and one terminal result callback. Standalone sandbox work such as
the benchmark may omit it. The runner never puts the bearer token into a
repository checkout, sandbox, report, or receipt. In production both this URL
and the API's `PROOF_RUNNER_RUNNER_URL` must use internal HTTPS;
`http://127.0.0.1:<port>` is accepted solely for local development and
integration tests.

The Squid default is pinned by digest. The runtime image may likewise be
supplied by digest through `PROOF_RUNNER_RUNTIME_IMAGE`; every report records
the actual runtime image digest.

## Limits

| Environment variable | Default |
| --- | ---: |
| `PROOF_RUNNER_REPOSITORY_BYTES` | 100 MiB |
| `PROOF_RUNNER_FILE_COUNT` | 20,000 |
| `PROOF_RUNNER_DISK_BYTES` | 512 MiB |
| `PROOF_RUNNER_CPU_COUNT` | 1 |
| `PROOF_RUNNER_MEMORY_BYTES` | 512 MiB |
| `PROOF_RUNNER_PIDS` | 128 |
| `PROOF_RUNNER_EXECUTION_MS` | 180,000 |
| `PROOF_RUNNER_OUTPUT_BYTES` | 1 MiB |

The execution timeout includes sandbox setup, clone, install, build, and test.
Configuration may lower it but can never raise it above 180 seconds.
Timeout, cancellation, lease expiry, registry failure, damaged lockfiles,
unsupported lifecycle hooks, and runner failures produce INCONCLUSIVE evidence.

## Verification and benchmark

```sh
pnpm --filter @ever-guild/proof-runner-runner test
PROOF_RUNNER_DOCKER_TESTS=1 \
  pnpm --filter @ever-guild/proof-runner-runner test:integration

export PROOF_RUNNER_BENCHMARK_REPOSITORY_URL=https://github.com/OWNER/REPOSITORY
export PROOF_RUNNER_BENCHMARK_REF_TYPE=tag
export PROOF_RUNNER_BENCHMARK_REF_VALUE=demo-fixed
pnpm --filter @ever-guild/proof-runner-runner build
pnpm --filter @ever-guild/proof-runner-runner benchmark
```

The benchmark performs ten serial target-worker runs and exits non-zero unless
p95 is at most 90 seconds and every run stays within the 180-second hard cap.
The checked benchmark evidence is in
[`docs/benchmark-2026-07-24.json`](docs/benchmark-2026-07-24.json).
# Runner configuration

The orchestrated runner requires `PROOF_RUNNER_BEARER_TOKEN` and
`PROOF_RUNNER_API_URL`. The latter is the internal API callback origin for
lease-renewal heartbeats and terminal results; startup fails closed when it is
absent or not an internal HTTP(S) URL.
