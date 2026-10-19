# ADR-009: Use eslint-plugin-import-x instead of eslint-plugin-import

- **Status:** Accepted
- **Date:** 2026-10-19
- **Task:** T-0004
- **Amends:** specs §4.1 (Lint row) and §6.2

## Context

§6.2 lists `eslint-plugin-import` for import ordering and cycle detection. Its latest release (2.32) declares `eslint` peer support only up to `^9`, and the project uses ESLint 10.

## Decision

Use `eslint-plugin-import-x` (a maintained fork with the same rules under the `import-x/` prefix, supporting ESLint 10 and flat config) together with `eslint-import-resolver-typescript`.

## Consequences

- `import-x/order` and `import-x/no-cycle` enforce the ordering and no-cycle rules from §6.2.
- Rule names in configs and disable comments use the `import-x/` prefix.
