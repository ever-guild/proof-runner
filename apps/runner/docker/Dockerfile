FROM node:22.17.1-bookworm-slim@sha256:2fa754a9ba4d7adbd2a51d182eaabbe355c82b673624035a38c0d42b08724854

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.32.1 \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin runner

USER 10001:10001
WORKDIR /workspace

ENV HOME=/tmp \
    CI=true

ENTRYPOINT []
