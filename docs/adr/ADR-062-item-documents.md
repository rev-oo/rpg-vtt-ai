# ADR-062: Items are edited on live documents of their own

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-1204
- **Covers:** FR-ENT-06
- **Amends:** ADR-015 §8 (item data is now edited live), specs §9.1–9.3

## Context

FR-ENT-06 asks for items edited on an item sheet. ADR-015 §8 kept plugin data out of REST bodies because it would be edited live on sheets (M5), but M5 built live documents for actors only. An item's data could therefore never change after it was created, and no item sheet could be opened.

An early draft of the spec kept owned items inside the actor document, as an `items` map keyed by id. That would let an actor's rules read its whole inventory at once, and give an actor one history. It was dropped when ADR-015 made items rows of their own, and it does not fit what was built since:

- library items have no actor, so they need a document of their own anyway;
- copying into an actor, the compendium's copies and "In the table" mark (ADR-060), single-item trash, paging (ADR-057) and events all work on rows;
- an actor document holding its inventory would grow with every item, and so would each sheet-history snapshot (ADR-053).

## Decision

1. **Documents.** Every item has `item:<id>:main`, and `item:<id>:secret` when its type declares secret fields, built like an actor's (specs §9.2). Items stay rows in `items`, and owned items stay out of the actor document.
2. **Access** (specs §9.3):
   - a library item is read by every member and written by GMs and assistants;
   - an owned item follows its actor's ownership, as the actor's main document does;
   - the secret document is for GMs and assistants only;
   - a deleted item, or an item whose actor is deleted, has no reachable documents.
3. **Persistence.** Stores refresh `items.system` from both layers, as for actors (§9.6). `ydocs.item_id` cascades, so an item's documents go when it is purged. Items keep no sheet history: ADR-053 stays actor-only.
4. **Web.** Items open as workspace panels (ADR-059) from the items panel and from an actor's items, with the same live sheet, presence and rich text as actors. Edits need `owner` access.
5. **Rolls.** Item sheets have no roll handler yet, so their roll buttons do nothing, as in the compendium preview. Rolling with an item (as its holder) is left for later.

## Consequences

- Plugin data of items is editable for the first time; nothing about the plugin format changes.
- Formulas cannot read an actor's items. When they need to (`@items`), the server can join item projections and live documents the way it joins an actor's two layers for rolls.
- Copies (giving a library item, duplicating an actor) start from the projection, which can lag a live edit by the store debounce (§9.6), as actor duplicates already do.
