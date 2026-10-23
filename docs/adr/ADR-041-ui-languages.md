# ADR-041: UI languages and the catalogue check

- **Status:** Accepted
- **Date:** 2026-10-23
- **Tasks:** T-0606
- **Refines:** NFR-11

## Context

NFR-11 asks for every core UI string in a message catalogue, with `en` as the default and `pt-BR` provided. M1 shipped `en` only, with `t()` reading it directly. T-0606 needs a `pt-BR` catalogue and a check that fails on a missing key.

## Decision

1. **`apps/web/src/i18n/pt-BR.ts`** is typed as `Messages`, the type of the `en` catalogue, so a missing key already fails `pnpm typecheck`.
2. **`catalogueProblems()`** (`apps/web/src/i18n/check.ts`) compares a catalogue with `en`: missing, extra and empty keys, and different `{placeholders}`. `test/i18n.test.ts` requires no problems for `pt-BR`, and shows that each kind of problem is caught.
3. **The language is picked once, when the app starts:**
   - the language chosen on the account page, kept in the browser's `localStorage`;
   - otherwise the first browser language we have, matching by language when the region differs (`pt-PT` gets `pt-BR`);
   - otherwise `en`.
   - Changing it reloads the page. `t()` stays a plain function, with no React context.
   - The build prerenders the loading page in English, whatever the build machine's language (Node 24 has a `navigator` global). The browser then shows its own language: the loading text may differ on hydration and is marked so, and `<html lang>` is set once the app loads.
4. **Plugin texts follow the same language** through `LOCALE`, with fallback to English (FR-PLUGIN-05). `<html lang>` is set to it.
5. **Server messages stay English.** The web words API errors from its catalogue where it knows the code, as before (CLAUDE.md, `describeIssue`).

## Consequences

- A new key added to `en` alone fails typecheck and the catalogue test until it is translated.
- The language is a browser preference, not an account setting; a per-user setting would need a column and is left for later.
