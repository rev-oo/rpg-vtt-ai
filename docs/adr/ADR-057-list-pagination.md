# ADR-057: Actor, item and journal lists page by name with opaque cursors

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-0812
- **Covers:** §10.1, ADR-015 (point 9)

## Context

ADR-015 left the entity lists unpaginated: a table's actors and items are bounded by one group's play, and permission filtering happens after the query. Packs (ADR-051) and long campaigns make a few hundred entries realistic, and every tab load and every `entity.changed` revalidation sent all of them. The lists are ordered by `lower(name), id` (journal: title), and that order must hold across pages. What a member may see is decided per row (ownership, hidden entries, the trash's "what you could restore"), so a page cannot simply be `LIMIT n` rows of the table.

## Decision

1. **Opt-in pages.** `GET /tables/:id/actors`, `/tables/:id/items`, `/actors/:id/items` and `/tables/:id/journal` take `limit` (1–100) and `cursor`. Without `limit` they answer the whole list, as before, so callers that need everything (the table loader's speaker and copy-target list) keep working. Every response carries `nextCursor`: the cursor of the next page, or `null` on the last page and for whole lists.
2. **Keyset cursors.** The cursor is base64url JSON of the last returned row's sort key: its lowercased name and its id. The next page reads rows after that key (`lower(name) > k OR (lower(name) = k AND id > id)`), so inserts and deletes between pages neither repeat nor skip the rows that stay. Like SQLite's `lower()`, the key folds ASCII letters only. A malformed cursor answers `400 invalid_cursor`.
3. **Full pages despite filtering.** The server reads rows after the cursor in batches of `limit + 1`, keeps those the caller may see, and repeats until it has one more visible row than the page holds, or the rows run out. A page is short only at the end of the list, and `nextCursor` is set only when another visible row exists.
4. **Web.** The actor, item and journal tabs load the first 50 entries with their filters. A "Load more" control at the end of the list loads the next page when it scrolls into view, or when clicked. A revalidation (after `entity.changed`, a filter change or a reconnection) starts the list over from its first page.

## Consequences

- Tab loads and revalidations send at most 50 entries, whatever the table holds.
- A player who sees few of many rows may make the server read several batches for one page; each batch is an indexed range read.
- After a revalidation, entries loaded beyond the first page are dropped until the user scrolls again.
- The table loader still reads all actors, for chat speakers and copy targets.
