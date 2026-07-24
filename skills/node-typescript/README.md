# node-typescript@1

This immutable runner skill accepts exactly one root `package-lock.json` or
`pnpm-lock.yaml`. It installs dependencies with lifecycle scripts disabled,
then runs the root build and test scripts without network access.

Projects declaring an install lifecycle hook are returned as
`INCONCLUSIVE/LIFECYCLE_SCRIPTS_REQUIRED`; ProofRunner does not guess whether
the hook is optional. The SHA-256 of `skill.json` is part of every dispatch.
