# ADR-063: Actor sheets hold their items, and formulas read them

- **Status:** Accepted
- **Date:** 2026-10-29
- **Tasks:** T-1205, T-1206, T-1207, T-1208
- **Covers:** FR-SHEET-12, FR-PLUGIN-15
- **Builds on:** ADR-062 (item documents), ADR-061 (item groups)

## Context

Since ADR-062, items have live sheets of their own, but an actor's items sit outside its sheet: the actor list shows them in a disclosure, and no formula can read them. Systems need an inventory on the character sheet, equipped gear and prepared spells, bonuses from what is equipped (armour adding to AC), and rolls made with an item ("attack with this sword"). ADR-062 left an `@items` join for this, and kept items out of the actor document.

## Decision

1. **State is plugin data.** Equipped, attuned, carried, prepared, quantity and charges are fields of the plugin's item types, such as `"equipped": { "type": "boolean" }`. The core adds no flag of its own, and the fields are edited in the item's document like any other (ADR-062).
2. **`@items.<type>[…]` in formulas.**
   - `@items.armor[*].acBonus` is a list of a field of every item of that type the actor holds.
   - `@items.armor[equipped].acBonus` keeps the rows whose boolean field is true.
   - `count(@items.spell[prepared])` counts rows.
   - The validator checks the type, the filter (a boolean field) and the field read, and names the type in its errors.
   - `@items` is allowed in actor types' derived values, `visibleIf`, recipes, outcomes and card rows. It is not allowed in item formulas, and item derived values are not reachable through it, so cycles stay within one type.
   - The server reads items as it reads actor layers: a live document when loaded, else its stored state, else the projection. It does so for rolls, combat and plugin code.
   - An actor holds at most 500 items.
3. **`items` sheet node.**
   - It lists the actor's owned items of `itemTypes` (all types when omitted), grouped by item group and ordered by name. Each row is laid out by `item`, as `list` lays out array rows.
   - Paths inside `item` are relative to the item's data, and are checked against every listed type unless a `visibleIf` on `@item.type` guards them.
   - `@item.name`, `@item.type` and `@item.id` name the row's item.
   - Row inputs write to the item's live document, which the sheet opens on its existing socket. Access is the item's (§9.3).
   - The core draws open, remove and add. Add offers the library's items of those types, and library or compendium rows can be dropped onto the node.
   - The open item documents also feed `@items` in the browser, so a toggle shows in derived values at once.
4. **`@item` in rolls.**
   - A recipe rolled from an `items` row, or from an owned item's own sheet, reads that item as `@item`.
   - Recipes that use it declare `"item": [<types>]`, which the validator checks reads against.
   - The roll request carries `itemId`, and the server checks that the item belongs to the rolling actor.
   - Library items have no holder, so their sheets still roll nothing.
5. **Core API.** These keys are additive. Plugins that use them declare a `coreApi` range that includes the version shipping them; the core's own API version is raised with the release.

## Consequences

- tiny-d20 gains armour and AC, attacks with its weapons, and prepared spells (T-1208).
- A sheet with many items opens many small documents on one socket. The 500-item limit bounds it, and the documents unload when the sheet closes (§9.6).
- Plugin code reads items through the same join; an SDK accessor for it is added with T-1205.
