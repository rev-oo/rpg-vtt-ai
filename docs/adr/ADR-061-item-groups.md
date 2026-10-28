# ADR-061: Item types declare a group, and item lists show items under it

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-1203
- **Covers:** FR-PLUGIN-11, Q16

## Context

A compendium of spells holds items of a plugin type `spell`. Q16 asked whether "item" should be renamed, now that items cover spells, feats and gear as well as things in a backpack. A rename would break the plugin format, the HTTP API and every list for a word that players need not read. What players do need is to see a character's spells apart from their gear, and a pack's spells apart from its weapons.

## Decision

1. **No rename (Q16).** "Item" stays the core term for typed data an actor holds, in code, the API and plugin files. Plugins name what players see through type labels and item groups.
2. **Item type keys.** An item type (`types/items/<type>.json`) may declare three optional keys:
   - `labelPlural`: the type's name for a list of them, such as "Weapons" (a lang key or literal text);
   - `group`: the heading the type's items sit under, such as "Spells" or "Gear" (a lang key or literal text). Types with the same `group` share one heading;
   - `order`: an integer from -1000 to 1000, default 0, that places the group.

   The validator checks the lang keys of `group` and `labelPlural` like every other text. Actor types do not take these keys.

3. **Grouping.** When the system declares a `group` on at least one item type, item lists show their rows under headings:
   - a type with a `group` goes under that group;
   - a type without one goes under its own heading, its `labelPlural` (or its `label`);
   - an item whose type the system no longer has goes under **Other**, last.

   Groups come by the lowest `order` of their types, then by heading. Rows keep the list's order (name order, ADR-057) inside a group. A system that declares no group keeps the single list it had.

4. **Where.** The items panel, an actor's items and the compendium group their rows. In the compendium, actor entries come first under one **Actors** heading. Grouping is done in the browser on the rows loaded so far, so paging (ADR-057) is unchanged; a group can grow when "Load more" brings more of its rows.
5. **Markup.** A grouped list is a `group` named like the plain list it replaces, with a heading and a list (named after the heading) per group. Under a group heading, row names are one heading level lower.
6. **tiny-d20** adds a `spell` item type in a "Spells" group and puts its weapons in "Gear"; its bestiary pack gains two spells.

## Consequences

- Plugins written for 0.2.0 are unchanged: the keys are optional, and lists without groups look as before. The core API version is not raised, since nothing a plugin relied on changed.
- Filters still work by type, not by group. A group filter can come later if it is missed.
- A group's rows are split across pages when a list is longer than a page, since the server pages by name, not by group.
