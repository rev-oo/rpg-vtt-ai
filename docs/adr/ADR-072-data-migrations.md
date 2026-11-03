# ADR-072: Table upgrades migrate data one entity at a time, with declarative steps and a hook

- **Status:** Accepted
- **Date:** 2026-11-03
- **Tasks:** T-1501
- **Covers:** FR-PLUGIN-12, §8.2, §8.10, §9.7
- **Amends:** ADR-058

## Context

ADR-058 lets a GM move a table to the installed system version, but its actors and items keep the data and `dataVersion` they were made with, and their sheets show an older-version notice for good. When a version renames, moves or reshapes fields, the old values sit where the schema no longer reads them. FR-PLUGIN-12 asks plugins to ship migrations that bring that data along when the table is upgraded.

## Decision

1. **Files.** `migrations/<version>.json` holds `steps`, each one of `rename`, `move`, `setDefault` or `drop` for one actor or item `type`, on a dot path where `*` stands for every row of a collection (`skills.*.rank`). The validator checks that the file name is an exact version no later than the manifest's, that the type exists (a warning otherwise, since the type may have been removed since), that a `move` keeps a value in its collection row, and that a `setDefault` value fits its field when the field exists. Migrations stay on the server: `GET /systems/:id` strips them as it strips packs.
2. **Steps run on stored data.** Steps run on an entity's data as JSON, both layers together, in the stored form (collections as maps of rows keyed by id). A step does nothing to an entity without the field, and replaces a value already at its target, since the new schema may have made it. A value on the way that is not an object fails the step.
3. **Hook.** For what steps cannot express, `code/server` may define `hooks.migrate({ kind, type, from, to, data })`, which returns the new data. It runs after the steps, once per entity, with no `ctx`: it only computes, so it needs no rights and posts nothing. An error, a time-out or an answer that is not an object fails the entity; plugin code that cannot load fails every entity it would have run on.
4. **When.** `POST /tables/:id/upgrade-system` sets the table's version, then migrates every actor and item of the table, trash included, whose `dataVersion` is semver-before the new version and whose type the system still declares. It runs every migration after the entity's `dataVersion` up to the new version, oldest first, then the hook.
5. **Checked, not repaired.** The result must fit the type's schema with nothing to repair (the store's repair, run on a scratch copy). Repairing would replace values with defaults, which is the data loss migrations exist to avoid, so any issue fails the entity instead.
6. **One entity at a time.** Each migrated entity is written in its own transaction: its documents' stored state, its projection and `dataVersion`. An actor's documents are kept in its sheet history first, forced (ADR-053), so a GM can go back. Open sheets get the migrated data applied to their live documents straight after, and an `entity.changed` event tells lists; entities in the trash are written without an event.
7. **Failures leave the entity.** A failed entity keeps its data and `dataVersion`, so its sheet keeps the notice. The table still moves. The response carries `migration`: the count migrated, the count failed, and up to 100 failures with the entity's kind, id, name, a reason code (`step`, `hook`, `code`, `invalid`) and, by reason, the migration version and step index or up to 20 value issues. `GET /tables/:id` and the upgrade response count `outdatedEntities` for those who may upgrade, and the settings page offers **Migrate again**, which calls the same endpoint: it is idempotent.
8. **Forwards only.** Data stamped with a version later than the table's, after a downgrade, is left as it is and not counted. Versions that are not exact semver are never behind.

## Consequences

- Plugins can change their data shape without leaving older sheets behind, and upgrading a table that has nothing to migrate just updates every `dataVersion`.
- A large table upgrades in one request, entity by entity; with the hook each entity is one round trip to the plugin's worker. That is fine at the sizes this app targets (NFR), and a later change could move it to a background job.
- Edits made on an open sheet while the hook runs for that entity are replaced by the migrated data. The window is one hook call.
- Failures are reported once, in the upgrade's answer; afterwards only the count remains, and the names show again on the next **Migrate again**.
- ADR-058's "`dataVersion` never changes" no longer holds: a migration updates it.
