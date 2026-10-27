# ADR-054: An archived table is read-only through the same checks as an unavailable system

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0807
- **Covers:** FR-TABLE-06

## Context

FR-TABLE-06 lets GMs and assistants archive a table: read-only, and still exportable later. A table is already read-only when its system plugin is unavailable (FR-PLUGIN-07): entity changes, rolls and collaborative documents go through `requireWritableTable` and `isTableWritable` (renamed from `requireWritableSystem` and `isSystemWritable`). That state still lets members chat and manage the table; an archive must not.

## Decision

1. **State.** `game_tables.archived_at`, shown to members as `archivedAt` on the table view. `POST /tables/:id/archive` and `POST /tables/:id/unarchive` (`canArchiveTable`: GMs and assistants) set and clear it, and send `table.updated`.
2. **One check.** `isTableWritable` is false while a table is archived, so every path already guarded for an unavailable system is guarded for the archive too: actors, items, journal entries, rolls, commands, combat, pack imports, history restores and the collaborative documents. The archive answers 409 `table_archived`, checked before the system's `table_read_only`.
3. **What the system check leaves open.** `requireUnarchived` also guards chat (REST and socket), chat edits and deletes, table settings, member roles, and invites: no invite can be created, and none accepted or used to sign up.
4. **Still allowed.** Reading everything, archiving and unarchiving, removing members and revoking invites, which only take access away.
5. **Live.** Open documents are rechecked after the request, like any access change: writers get `access: readOnly` and their updates are dropped; unarchiving gives write back.
6. **UI.** The table list marks archived tables; the table shows a read-only notice and no chat composer; the settings page, which is GM-only, archives and unarchives.

## Consequences

- An archived table cannot be changed by anyone, including its GM, until it is unarchived.
- Edit buttons in the web stay visible on an archived table; the server refuses their requests with a translated message.
- Exporting archived tables waits for an export feature.
