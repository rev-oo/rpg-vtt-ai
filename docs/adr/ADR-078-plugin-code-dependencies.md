# ADR-078: Reference plugin code with npm dependencies

- **Status:** Accepted
- **Date:** 2026-11-09
- **Tasks:** T-1604
- **Covers:** §5, §8.10
- **Builds on:** ADR-025 (plugin client code), ADR-045 (CLI and SDK built from this repository), ADR-074 (client sandbox), ADR-077 (module overlays)

## Context

`plugins/dice-3d` (T-1604) bundles three.js and cannon-es into its client code. `vtt-plugin pack` bundles whatever `code/client.*` imports, resolving it from `node_modules` beside the code, but the plugin format has no place for dependencies. A `package.json` at the plugin's root is reported as an unknown file and packed into the archive. T-1604 was to change only the plugin and the docs, not the workspace.

## Decision

1. **The code folder is a package of its own.** `plugins/dice-3d/code/package.json` lists the dependencies at exact versions, with the in-repo SDK and Vitest preset as `link:` dev dependencies, and `typecheck` and `test` scripts. It is not a workspace package: it is installed with `pnpm install --ignore-workspace --lockfile=false` in `code/`. Three.js and cannon-es have no dependencies of their own, so exact versions pin what is bundled without a lockfile.
2. **Nothing of it ships.** `pack` skips `.json` and script files under `code/` other than the entries, dot files and `node_modules`, so `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` and `test/` stay out of the archive; only the bundled `code/client.js` ships. Any other file under `code/` would ship, such as a `pnpm-lock.yaml` (hence no lockfile) or a coverage report (hence none is written).

## Consequences

- The workspace and its lockfile are unchanged. The e2e test `dice-3d.spec.ts` installs the code's dependencies before packing the plugin; the plugin-schema tests validate its files like the other reference plugins, skipping `code/node_modules` and the JSON under `code/`; the type check and unit tests of its code run by hand in `code/`, and the T-1604 study proposes bringing them into CI.
- Authors outside this repository have no documented way to declare dependencies; the study proposes one.
