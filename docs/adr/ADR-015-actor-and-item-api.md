# ADR-015: Actor and item REST API

- **Status:** Accepted
- **Date:** 2026-10-20
- **Task:** T-0202
- **Amends:** §10.1 (adds restore and owned-item endpoints; entity lists are not paginated yet)

## Context

T-0202 exposes actors and items over REST with ownership enforced on every endpoint. Two inputs the rules need do not exist yet: the actor and item types a system declares (they come from the plugin loader, M4), and the GM's "players may create other types" switch (FR-ENT-01).

## Decision

1. **Type catalogue on the `plugins` row.** `actor_types` maps each type to `{ controlledBy }` and `item_types` lists item types. The scanner (T-0403) will fill them from the manifest; until then tests seed them, as with the `plugins` table itself (ADR-011). Unknown types get `422 unknown_actor_type` / `unknown_item_type`.
2. **`playersMayCreateAnyActorType`** is a core table option (column on `game_tables`, `PATCH /tables/:id`, GM only). Plugin settings (§8.12) stay in `settings`.
3. **Ownership.**
   - A player's new actor is theirs alone: `{ default: 'none', users: { <them>: 'owner' } }`.
   - Only GMs and assistants set or change ownership. A GM's actor without explicit ownership is hidden from players.
4. **Visibility.** Members who may not see an actor, and non-members, get `404`, so ids cannot be probed (as for tables, FR-AUTH-08). Members who may see but not edit get `403` on writes. Responses carry the caller's `access` (`observer` or `owner`).
5. **Items.**
   - The library is curated by GMs and assistants and read by every member.
   - Owned items follow their actor's ownership, and are unreachable while the actor is in the trash.
   - Copying (`POST /actors/:id/items`) takes a live library item from the same table.
6. **Trash.**
   - `?trash=restorable` lists only what the caller could restore.
   - `POST /actors/:id/restore` and `POST /items/:id/restore` return `409 not_deleted` or `410 restore_expired`.
   - Expired trash is purged at startup and every 6 hours.
7. **Duplicate.**
   - Needs read access to the actor and permission to create its type.
   - A GM's copy keeps the ownership; anyone else owns their copy alone.
   - Owned items are copied with their `sourceId`.
8. **Plugin data is read-only over REST.** `system` is returned as a projection but not accepted in bodies; it is edited live on the sheet (M5; items since ADR-062). New entities start with `{}` until the plugin engine supplies defaults (T-0407).
9. **No pagination on entity lists yet.** A table's actors and items are bounded by what one group plays with, and permission filtering happens after the query. Cursor pagination (§10.1) is added if lists grow; chat history (T-0205) has it from the start. Superseded by ADR-057, which adds it.
10. **A default character must be the member's own live actor on the table** (`400 invalid_character`).

## Web client (T-0208)

- `GET /tables/:id/types` lists the system's actor and item types for the creation forms. If the plugin is missing it answers `422 system_unavailable`; the page then opens without creation.
- The table page is a parent route with two tabs, actors (`/tables/:id`) and items (`/tables/:id/items`).
  - The filters live in the URL (`?q=…&type=…&trash=1`), and each tab's loader fetches its list.
  - Every `entity.changed` event, and every reconnection, revalidates the lists. Changing a tab or a filter reloads only the tab, not the table, members or chat.
- Edit controls follow `access` and the shared permission checks (`canCreateActor`, `canSetOwnership`, `canManageItemLibrary`). The server still enforces them.
- The ownership dialog lists only players and spectators, because GMs and assistants own every actor anyway.
- An actor's own items are listed on demand. Copying a library item into an actor uses the "Give" control on the items tab.

## Consequences

- T-0403 must write `actor_types` and `item_types`.
- The web (T-0208) can show edit controls from `access` without re-implementing ownership rules.
- `GET /actors/:id/items` and the two restore endpoints extend the §10.1 list.
