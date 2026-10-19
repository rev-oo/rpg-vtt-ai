# ADR-010: One root ESLint config instead of per-package configs

- **Status:** Accepted
- **Date:** 2026-10-19
- **Task:** T-0004, T-0007
- **Amends:** T-0004 ("per-package configs extending `packages/config`")

## Context

T-0004 asks for a root `eslint.config.mjs` plus per-package configs extending `packages/config`. With one config file per package, each package got its own `typescript-eslint` project service. Linting files from all packages in one process (lint-staged on a large commit, the VS Code ESLint server) used more than 2 GB of memory and crashed. A single config used about 640 MB for the whole repository.

## Decision

- The rules live in `@vtt/config/eslint` (`packages/config/eslint/`). Package-specific rules (globals, React hooks, module bans, `no-console` in the server) are generated from `packages/config/eslint/workspace.mjs` and scoped to each package's directory with `files` globs.
- The repository has exactly one `eslint.config.mjs`, at the root, which calls `defineVttConfig()`.
- Each package keeps its own `lint` script (`eslint . --max-warnings 0`). ESLint 10 finds the root config by looking upward from each file, so Turborepo still runs and caches lint per package.

## Consequences

- Adding a workspace package means registering it in `workspace.mjs` (type, preset kind and allowed imports).
- Turborepo lists `eslint.config.mjs` in `globalDependencies`, so a rule change invalidates every package's lint cache.
