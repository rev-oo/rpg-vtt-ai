# ADR-008: Pin TypeScript to 6.0.x

- **Status:** Accepted
- **Date:** 2026-10-19
- **Task:** T-0002

## Context

ADR-005 requires TypeScript strict everywhere and type-aware linting with `typescript-eslint`. The latest TypeScript release is 7.0.x, but `typescript-eslint` 8.71 (the latest) declares `typescript: >=4.8.4 <6.1.0` as its peer range.

## Decision

Pin `typescript` to `~6.0.3` in the root `package.json`. Revisit when `typescript-eslint` supports TypeScript 7.

## Consequences

- Type-aware lint rules (`strictTypeChecked`, `stylisticTypeChecked`) work on a supported compiler.
- We do not get TypeScript 7's native compiler speed yet.
- `tsconfig.base.json` sets every option explicitly (including `types`) so the TypeScript 7 upgrade does not change behaviour through defaults.
