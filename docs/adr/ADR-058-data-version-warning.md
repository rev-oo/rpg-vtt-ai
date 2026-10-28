# ADR-058: Tables follow their system's installed version, and sheets warn about older data

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-0813
- **Covers:** §9.7, FR-PLUGIN-01

## Context

Actors and items store `dataVersion`, the system version they were made with (§9.7), but nothing compared it. A table stored `system_version` once, at creation, and replacing a plugin with a newer version never changed it. Three things followed: new actors and items on an upgraded table were stamped with the old version, the table header showed the old version, and the web keyed its loaded-system cache on it. Plugin data migrations stay LATER, so the most the core can do is tell people that a sheet predates the system it is shown with.

## Decision

1. **Tables follow the installed plugin.** Each plugin scan (at start, and after an install or replacement) sets `system_version` of every table on that system to the version in its manifest. A plugin that fails to parse leaves its tables as they are.
2. **Entities keep their version.** `dataVersion` is still set when an actor or item is created (from the table's now-current version, including pack imports) and never changed.
3. **The sheet warns.** When an actor's `dataVersion` differs from its table's `systemVersion`, the actor sheet shows an info notice naming both versions and saying that fields changed since may show their defaults. It shows to everyone who opens the sheet, whatever the direction of the difference (a downgrade warns too).
4. **Items** carry `dataVersion` in their views too, but have no sheet yet; they get the notice with one.

## Consequences

- After an upgrade, tables, their headers and newly made entities all report the installed version.
- Every sheet made before an upgrade shows the notice for good: without migrations nothing brings its data up to date. A plugin data migration (LATER) would update `dataVersion` and so clear it.
- Versions are compared as strings: any difference warns, without semver ordering.
