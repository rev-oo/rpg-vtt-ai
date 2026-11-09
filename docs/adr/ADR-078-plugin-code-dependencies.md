# ADR-078: Reference plugin code with npm dependencies

- **Status:** Accepted
- **Date:** 2026-11-09
- **Tasks:** T-1604
- **Covers:** §5, §8.10
- **Builds on:** ADR-025 (plugin client code), ADR-045 (CLI and SDK built from this repository), ADR-074 (client sandbox), ADR-077 (module overlays)

## Context

`plugins/dice-3d` (T-1604) bundles three.js and cannon-es into its client code. `vtt-plugin pack` bundles whatever `code/client.*` imports, resolving it from `node_modules` beside the code, but the plugin format has no place for dependencies, and the reference plugins so far had none: they are not workspace packages, and their code is not type-checked or tested. A `package.json` at the plugin's root is reported as an unknown file and packed into the archive.

## Decision

1. **The code folder is the package.** A reference plugin with dependencies keeps a `package.json` in `code/`, with its dependencies, the SDK and the Vitest preset as dev dependencies, and `typecheck` and `test` scripts. `pnpm-workspace.yaml` includes `plugins/*/code`; folders without a `package.json` (`tiny-d20/code`) are not packages. The repository's lockfile pins the dependencies.
2. **Nothing of it ships.** `pack` skips `.json` and script files under `code/` other than the entries, dot files and `node_modules`, so `package.json`, `tsconfig.json`, `turbo.json`, `vitest.config.ts`, `src/` and `test/` stay out of the archive; only the bundled `code/client.js` ships. Any other file under `code/` would ship, so the package writes no coverage report there.
3. **Checked like the workspace, linted like plugins.** `pnpm typecheck` and `pnpm test` run the package through Turborepo. ESLint keeps ignoring `plugins/*/code/`, as for every plugin; `workspace.mjs` registers the package and allows it only `@vtt/sdk/client`. The plugin-schema tests validate its files with the other reference plugins, skipping `code/node_modules` and the JSON under `code/`.

## Consequences

- Reference plugin code with dependencies is type-checked and unit-tested in CI, and the e2e suite packs it like any other reference plugin.
- Authors outside this repository have no documented way to declare dependencies; the T-1604 study proposes one.
