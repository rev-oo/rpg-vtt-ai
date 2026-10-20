# ADR-014: Entity persistence (actors, items, journal metadata)

- **Status:** Accepted
- **Date:** 2026-10-20
- **Task:** T-0201
- **Decides:** Q6 (soft-delete retention)

## Context

T-0201 adds the SQL tables and repositories for actors, items and journal entries. The PRD fixes the broad shape (ownership JSON, soft delete with 30-day restore, CRDT documents for live data in M5) but leaves a few details open.

## Decision

1. **Retention is configurable (Q6).** `SOFT_DELETE_RETENTION_DAYS` (default 30, 1–3650) sets how long a deleted actor, item or journal entry can be restored. The repositories take the window as an argument (`Retention`), so tests can move time.
2. **The trash is `soft_deleted_at`.** Live queries ignore deleted rows. The trash lists only rows still inside the window. A restore after the window returns `expired`, and `purgeDeletedEntities()` removes those rows for good. Scheduling the purge is left to the API work that exposes the trash (T-0202).
3. **Owned items are `items` rows with `actor_id` set** (and `source_id` pointing at the library item they were copied from, FR-ENT-05). Library items have no `actor_id`. Owned items are removed with their actor; a copy survives its source being purged (`source_id` is set to null). §9.2 puts owned items in the actor's CRDT document; when that arrives (M5), these rows become its projection.
4. **Only actors and journal entries carry ownership.** Library items belong to the table, and owned items follow their actor. Defaults: actors `none`, journal entries `observer` (FR-JOURNAL-02).
5. **Plugin data is a JSON projection** in `system` (§9.6), stamped with the plugin version in `data_version` (§9.7). The live data stays in the CRDT document (M5).
6. **Removing a member drops their per-user levels** on the table's actors and journal entries (FR-TABLE-04). The entities stay on the table and fall back to the default level.
7. **Search is a literal, case-insensitive substring** (`instr(lower(name), …)`), so `%` and `_` in a search term need no escaping.

## Consequences

- Repositories live in `apps/server/src/db/repositories/`, one module per entity, plus shared soft-delete helpers.
- The REST API (T-0202) enforces ownership with the `@vtt/shared` permission functions; the repositories do not filter by user.
- `members.default_character_id` still has no foreign key. The member API checks it against the table's actors in T-0202.
