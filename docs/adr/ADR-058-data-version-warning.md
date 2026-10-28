# ADR-058: GMs upgrade a table to its system's installed version, and sheets warn about older data

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-0813
- **Covers:** §9.7, FR-PLUGIN-01, FR-TABLE-07

## Context

Actors and items store `dataVersion`, the system version they were made with (§9.7), but nothing compared it. A table stores `system_version` at creation, and replacing a plugin with another version never changed it, so a table could not tell it was behind. Plugin data migrations stay LATER, so the most the core can do is let the table move on deliberately and tell people when a sheet predates the version it is shown with.

Moving tables automatically on every plugin scan was considered and rejected: an upgrade changes what new entities are stamped with and makes every existing sheet show a notice, and that is the GM's call for their table, not a side effect of an admin installing a plugin.

## Decision

1. **Tables keep their version.** Installing or replacing a plugin does not change `system_version`. `TableView` carries both `systemVersion` (the table's) and `installedVersion` (the plugin's, or `null` when it is not installed).
2. **GMs upgrade.** `POST /tables/:id/upgrade-system`, for GMs and assistants (`canUpgradeTableSystem`), sets `system_version` to the installed version and publishes `table.updated`. The table must be writable: archived tables answer `409 table_archived`, and tables whose system is disabled or broken `409 table_read_only`.
3. **Web.** When the versions differ, GMs and assistants see a notice on the table page linking to the settings, where a "System version" section offers "Upgrade to X". Other members see nothing until the upgrade.
4. **Entities keep their version.** `dataVersion` is set from the table's version when an actor or item is made (packs included) and never changed. When it differs from its table's `systemVersion`, the actor sheet shows an info notice naming both versions, to everyone who opens it. Items have no sheet yet; their views carry `dataVersion` for when they get one.

## Consequences

- An admin can install a new plugin version without changing any table; each GM chooses when their table moves.
- Until then the table renders with the installed plugin's files, but new entities get the table's version, so their sheets show no notice.
- After an upgrade, every sheet made before it shows the notice for good: without migrations nothing brings its data up to date. A plugin data migration (LATER) would update `dataVersion` and so clear it.
- Versions are compared as strings: any difference counts, without semver ordering, and a downgrade can be "upgraded" to as well.
