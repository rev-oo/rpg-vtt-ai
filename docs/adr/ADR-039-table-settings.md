# ADR-039: Table settings checked against the system's house rules

- **Status:** Accepted
- **Date:** 2026-10-23
- **Tasks:** T-0603 (server side; the form comes with the M6 web PR)
- **Refines:** specs §8.12, FR-ADMIN-04, FR-TABLE-07

## Context

Tables already stored a `settings` record, and rolls already passed it to the plugin engine, where `settingValues` replaced any value that did not fit with the setting's default. But the API accepted anything: names the system does not define, and values of the wrong type or out of range. Those were kept silently and then ignored. Clients with an open sheet were also not told when settings changed, so their derived values went stale.

## Decision

1. **A table's settings are its system's house rules**, the options of `settings.json` (§8.12), and nothing else.
2. **Creating a table and `PATCH /tables/:id` check them** with `settingsIssues()` from `@vtt/plugin-engine`, which shares `settingIssue()` with `settingValues()`.
   - A name the system does not define, or a value that does not fit, gets 400 `validation_failed`.
   - Each detail is `{ path: "settings.<name>", reason, message }`. `reason` is a data issue reason (`type`, `enum`, `minimum`, `maximum`, `maxLength`) or `unknown`, so the web form can word it from its catalogue.
   - The settings sent replace the stored ones. Settings left out fall back to their defaults.
3. **House rules change only while the system is available.** Otherwise the table is read-only and a settings change gets 409 `table_read_only` (FR-PLUGIN-07). Renaming still works.
4. **`table.updated`** is a new event on `/ws/events`, sent to the table's subscribers after every successful `PATCH`. Clients refetch the table, so open sheets recompute derived values with the new settings.
5. **tiny-d20 uses its `startingHp` setting** in a derived `maxHp` (`@settings.startingHp + @level - 1`). This gives the reference plugins a house rule that changes a derived value, which is what the task's done-when needs.

## Consequences

- Tested in `apps/server/test/system-rolls.test.ts`: the GM changes `startingHp` and a roll of `@derived.maxHp` follows; refused values, unknown names and an unavailable system are covered too.
- Settings stored before this check, such as names a plugin has since dropped, stay in the row until the next `PATCH`. `settingValues()` still ignores them.
- The web app does not react to `table.updated` yet. The M6 web PR adds the settings form and the refetch.
