# ADR-027: Reference plugins

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0411, T-0412
- **Amends:** ADR-025 §3 (details below)

## Context

T-0411 asks for tiny-d20 with one custom node (`hpBar`), and T-0412 for tiny-pool without any code. Each must be checked end to end, but sheets cannot edit data before live sheets (M5), and some features have no place in the app yet.

## Decision

1. **tiny-d20 has code.**
   - `code/client.tsx` defines `hpBar`. It reads `<path>.value` and `<path>.max` through `useField` and shows a `meter` with the numbers beside it. The bar is drawn from `currentColor` and `--vtt-accent`, so it works in both colour schemes.
   - The manifest sets `hasCode: true`, so admins must acknowledge the code when they enable the plugin (FR-PLUGIN-06).
   - Its accent gets a lighter dark-scheme value, for WCAG AA contrast (NFR-10).
2. **Plugin sources stay outside the workspace.**
   - `plugins/*/code/` is not a workspace package, so ESLint ignores it, as it does the e2e fixtures (ADR-025). The folder's imports resolve through `vtt-plugin pack` or the app's import map, not `node_modules`.
   - The code was type-checked once against `@vtt/sdk/client`'s declarations; `vtt-plugin pack` and the e2e tests exercise it.
   - Server tests copy the reference plugins through `test/support/reference.ts`, which leaves out `code/` and `custom:` sheet nodes and sets `hasCode: false`. The server only loads compiled code, and those tests are about data files and code acknowledgement with their own stubs.
   - The sheet preview of `sheet-renderer` lists `code/` files for the `hasCode` check. It renders without client code, so `hpBar` shows the missing-node notice there; `vtt-plugin dev` renders it.
3. **End-to-end path.**
   - `e2e/tests/reference-plugins.spec.ts` packs each plugin from `plugins/` with the built CLI, installs it through `POST /plugins/install`, enables it, and plays a table.
   - Until sheets write data (M5), the test sets actor data in the database, as the server tests do.
   - **tiny-d20** covers:
     - fields, defaults and derived values in its English texts;
     - the counter, the `hpBar` node and its scoped CSS;
     - `visibleIf` at zero hit points, the image placeholder and tabs;
     - a skill row's recipe roll with its card and outcome;
     - the NPC sheet and attack roll;
     - the secret layer: the GM sees GM notes, the owning player does not.
   - **tiny-pool** covers its sheet and derived pool, a success-counting pool roll with outcomes, and a `4dF` roll with its custom die, all with no code.
4. **Not checkable in the app yet.**
   - pt-BR texts: the UI is English until T-0703; the validator checks key coverage.
   - Table settings: no settings page until M6.
   - The `weapon` item sheet: item sheets are not mounted yet. The sheet-renderer preview test renders it.
5. **Card messages keep their dice (amends ADR-025 §3).** A card message that falls back to its text, such as a recipe without a card file like tiny-pool's rolls, now also shows its dice, as every roll does (FR-CHAT-04).

## Consequences

- The reference plugins go through the same pipeline as third-party plugins: CLI, archive, install, enable.
- The tests that seed the database switch to sheet edits with M5.
