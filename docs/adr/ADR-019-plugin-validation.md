# ADR-019: Plugin validation

- **Status:** Accepted
- **Date:** 2026-10-21
- **Tasks:** T-0401, T-0402, T-0403
- **Amends:** §5 (the validator lives in `plugin-schema`; the server only reads the folder), §8.4 (reserved field names), §8.5 (the `derived` node takes a `label`), §8.8 (custom dice may map text faces to numbers)

## Context

The server's scanner (T-0403) and `vtt-plugin validate` (T-0410) must report the same problems for the same folder, with file and JSON path (FR-PLUGIN-02). §5 places a validator under the server, and §8.13 gives the CLI its own. The formula language (ADR-017) gives `@` references, but §8 does not say which reference roots the core provides or how a lang key differs from literal text.

## Decision

1. **One validator, in `@vtt/plugin-schema`.** `validatePlugin(files)` is pure: it takes a map of every path in the folder to its text and returns issues, plus a `PluginDefinition` when no issue is an error. The server and the CLI read the folder and call it.
   - Issues carry a `code`, `severity`, `file`, JSON `path` and `params`, without prose. `describePluginIssue` words them in English for the server and the CLI; the admin page (T-0406) translates the codes.
   - Paths print as `$.layout.children[2].path`.
2. **What it checks.**
   - Every file against its Zod schema. A broken union member is reported as the member it was meant to be, so a bad `field` node is not also reported as a bad custom node. Unsupported keywords (§8.4) get their own code.
   - Names of types, sheets, cards, recipes, dice, settings and locales.
   - Data schemas: defaults fit their fields, `x-kind` and `x-counter` fit their types.
   - Formulas: syntax, references, functions (built-ins only without code), custom dice, and dice only in roll formulas (pure mode elsewhere). Derived values must not form a cycle.
   - Links: a type's sheet, a button's recipe, a recipe's card, a `derived` node's key, and each sheet field against every type that uses the sheet, including the input it is shown with.
   - `hasCode` against the `code/` folder; custom nodes and handler recipes need code.
   - Translations: once any lang file exists, English is required, and every listed locale needs a file. A missing English text is an error; a missing text in another locale is a warning, since English is the fallback (FR-PLUGIN-05).
   - A JSON file of no known kind (such as `packs/`, v1) is a warning.
   - `coreApi` must be a semver range that includes this core's `CORE_API_VERSION` (`@vtt/shared`), and, when the caller names the folder, the id must match it (T-0403).
   - CSS rules are checked by the CSS processor (T-0404).
3. **Reference roots.** Formulas get `@derived.*`, `@args.*`, `@row.*`, `@settings.*`, `@total` and `@roll.*` from the core, so a top-level field may not take one of those names. Each root exists only where it makes sense: `@row` inside a list, `@args` in recipes, `@total` and `@roll` in outcomes and cards.
4. **Which type a formula belongs to.** Sheets are checked against the types that use them, and recipes and cards against the types whose sheets roll them. When nothing ties a formula to a type, or that type's file is broken, data references go unchecked instead of failing in cascade.
5. **Lang keys.** A text with no spaces and at least one dot (`type.character`) is a lang key; anything else is literal text, as §8.5 allows.

## Consequences

- The scanner, the CLI and the tests share one list of issue codes.
- A recipe used by both an actor and an item sheet must work with both data schemas.
- Composition keywords and per-locale lang files with other names can be added later without changing the issue format.
