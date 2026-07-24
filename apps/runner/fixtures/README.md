# Runner fixture matrix

| Fixture | Expected result |
| --- | --- |
| `passing` | PASS after build and test |
| `failing` | FAIL with a failed test check |
| `timeout` | TIMEOUT / INCONCLUSIVE |
| `invalid` | INCONCLUSIVE / `LOCKFILE_MISSING` |
| `oversized` | INCONCLUSIVE / repository limit |
| `lifecycle` | INCONCLUSIVE / `LIFECYCLE_SCRIPTS_REQUIRED` |
| `pnpm-passing` | PASS through the pinned pnpm path |
| `git-lfs` | INCONCLUSIVE / `GIT_LFS_UNSUPPORTED` |
| `submodule` | INCONCLUSIVE / `SUBMODULES_UNSUPPORTED` |
| `damaged-lockfile` | INCONCLUSIVE / `DAMAGED_LOCKFILE` |
| `registry-failure` | INCONCLUSIVE / `REGISTRY_FAILURE` |

The lifecycle fixture writes local/network marker files from `postinstall`.
Tests require both markers to remain absent. Production stops before install
when a root lifecycle hook is declared, while all dependency installation also
uses the package manager's `--ignore-scripts` flag.
