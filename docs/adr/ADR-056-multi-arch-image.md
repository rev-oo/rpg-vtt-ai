# ADR-056: The image is built natively for amd64 and arm64 and merged into one tag

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0811
- **Covers:** §4.2 (deployment), ADR-046

## Context

0.1.0 published a `linux/amd64` image only, so self-hosters on arm64 machines (Raspberry Pi, Apple silicon servers, Ampere and Graviton hosts) could not run it. The image compiles nothing itself, but `pnpm install` and the web build are heavy, and `better-sqlite3` is a native module. Building arm64 under QEMU emulation on an amd64 runner works but is many times slower. GitHub offers hosted arm64 Linux runners (`ubuntu-24.04-arm`) for public repositories.

## Decision

1. **Checks.** The `docker` CI job runs on both `ubuntu-latest` and `ubuntu-24.04-arm`: each builds the compose example natively and runs `docker/smoke-test.sh`, on every push and pull request.
2. **Release.** On a `v*` tag, an `image` job builds each architecture on its own runner and pushes it by digest. The `release` job then tags one manifest list holding both digests (`docker buildx imagetools create`), checks that both platforms are in it, and makes the GitHub release.
3. **Tags.** Unchanged: `X.Y.Z` and `X.Y`, now pointing at the manifest list, so `docker pull` picks the right architecture.

## Consequences

- No emulation: each image is built and smoke-tested on the hardware it runs on.
- A release needs both runner kinds; if arm64 runners are unavailable, the release waits.
- Per-architecture images exist only by digest; nothing tags them separately.
