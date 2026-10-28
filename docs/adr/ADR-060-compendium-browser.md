# ADR-060: Members browse the compendium and copy chosen entries

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-1202
- **Covers:** FR-PLUGIN-09
- **Supersedes:** ADR-051 §4, §5 and §7 (pack format, data and library stay)

## Context

ADR-051 let GMs import a whole pack into a table, once, from the settings page. That suits a short bestiary, but not a pack of a few hundred spells or items. A GM wants three monsters for tonight, and players want one sword on their character. FR-PLUGIN-09 now asks for a browser that every member can use, and for copies of chosen entries. The table workspace (ADR-059) gives the browser a place of its own.

## Decision

1. **Listing.** `GET /tables/:id/compendium` answers every member with:
   - `packs`: the system's packs, as `{ name, label }`, for the pack filter;
   - `entries`: each entry of every pack, as `{ ref, pack, kind, type, name, system, inTable }`;
   - `nextCursor`.

   `search` (a case-insensitive substring of the name), `pack`, `kind` and `type` filter the list. Entries come in name order, paged as in ADR-057 (`limit`, opaque `cursor`, same sort key). A table whose system is unavailable answers `422 system_unavailable`.

2. **Entry data.** `system` is the entry's data as a copy would start with it: lists become keyed rows (ADR-051 §2). The fields the caller may not see are removed, as on actors and items (FR-SHEET-04), so a player's preview never holds a GM's secret notes.
3. **"In the table".** `inTable` says whether the table already holds a copy: an actor or a library item with the entry's ref, live or in the trash. Items on an actor are that actor's copies, not the table's library, so they do not count.
4. **Copying.** `POST /tables/:id/compendium/copy` takes `{ refs, actorId? }`, with 1–50 refs, and answers `201` with the created `actors` and `items`. Each created entity is announced with `entity.changed`.
   - **Without `actorId`:** GMs and assistants (`canCopyCompendiumToTable`) copy actor entries into the table's actors and item entries into its library. The new actors are owned by whoever copies, as when they create one.
   - **With `actorId`:** whoever may edit that actor copies item entries onto it. This includes players with their characters. Copying an actor entry onto an actor answers `422 not_an_item`.
   - **Rules for every copy:** the table must be writable, and an unknown ref answers `404`. Every copy keeps its entry's ref as `pack_ref`.
5. **No once-only rule.** Copying an entry again makes another copy (two goblins are a fair request), unlike ADR-051's import. The `inTable` mark tells the GM what is already there.
6. **Web.** A **Compendium** panel joins the lists in the workspace. It holds:
   - a search, and pack and type filters;
   - "Load more" paging;
   - an "In the table" mark on each entry;
   - a **Preview** that renders the entry's own sheet, read-only, from its data;
   - **Copy to the table**, for GMs and assistants;
   - **Copy** onto a chosen actor the caller owns, for item entries.

   Its filters are not saved with the layout.

7. **Removed.** `GET /tables/:id/packs`, `POST /tables/:id/packs/:name/import`, their schemas, `canImportPacks` and the settings page's Compendium section are gone.

## Consequences

- Players can see every entry of a pack, including NPCs, without their secret fields. A system that wants surprises keeps them in GM-only fields, or out of packs.
- A GM who wants a whole pack copies it page by page, at most 50 entries at a time. A "copy all" control can come later if it is missed.
- The server holds packs in memory, with the plugin definition, and filters them there. That is fine for packs of up to 1,000 entries each (ADR-051 §1).
- Entities imported under ADR-051 keep their `pack_ref`, so the browser marks them as in the table.
