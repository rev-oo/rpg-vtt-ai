# ADR-084: Plugin API 1.0 and what 1.x keeps

- **Status:** Accepted
- **Date:** 2026-11-13
- **Tasks:** T-1701
- **Covers:** FR-PLUGIN-03
- **Builds on:** ADR-019 (plugin validation), ADR-020 (plugin registry), ADR-046 (releases)
- **Decides:** Q19

## Context

The core has provided plugin API `0.1.0` since the first release. Every 0.x release could change the plugin format, and several did. The project releases 1.0.0 at M17, and the plugin format is what other people build on, so 1.0 has to say what plugin authors can rely on.

No instance runs third-party plugins yet. The only plugins are the reference plugins in `plugins/` and the e2e fixtures. Q19 asked whether 1.x should still load plugins that declare `^0.1.0`.

## Decision

1. **`CORE_API_VERSION` is `1.0.0`.**
   - It stays apart from the release version (ADR-046). It moves to `1.N.0` when a release adds to the plugin API, and to `2.0.0` when one breaks it.
   - The reference plugins, the fixtures and the guide declare `^1.0.0`.

2. **1.x keeps the plugin API compatible.** The API covers:
   - the plugin files and their keys, as the reference lists them;
   - formulas;
   - the exports of `@vtt/sdk/client` and `@vtt/sdk`, and server `ctx`;
   - the testing kits;
   - module themes, named parts, and frame events and actions;
   - settings scopes.

   A minor version may:
   - add optional keys, files and other features;
   - add validator checks, but only as warnings;
   - deprecate something, with a warning, and remove it only in 2.0;
   - fix bugs and security holes.

   The promise does not cover:
   - the app's markup and classes inside named parts;
   - the HTTP API and socket messages;
   - the database;
   - the wording of issues;
   - limits, which may only grow.

   The guide's **Compatibility** section is the promise as authors read it.

3. **Plugins declaring 0.x do not load (Q19: no).**
   - The validator's `coreApi` check stays as it is. A `0.x` range fails `incompatible_core_api`, and the Plugins page lists the plugin as unusable with that reason.
   - Nothing marks or adapts 0.x plugins.

## Consequences

- Authors get one rule: declare the lowest `1.x` whose features the plugin uses. An older 1.x server then refuses the plugin up front, and does not fail on a key it does not know.
- The 1.x line has to add to the plugin format and never change it. A change that breaks plugins waits for 2.0, or comes as a new key next to the old one.
- Strict schemas (`strictObject`) stay safe: a key added in `1.N` is unknown to an older server, but that server already refuses the plugin by its `coreApi`.
- There is no code that loads plugins across majors. If a 2.0 wants it, it can bring it then.
