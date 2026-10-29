# ADR-063: Actor sheets hold their items, and formulas read them

- **Status:** Accepted
- **Date:** 2026-10-29
- **Tasks:** T-1205, T-1206, T-1207, T-1208
- **Covers:** FR-SHEET-12, FR-PLUGIN-15
- **Builds on:** ADR-062 (item documents), ADR-061 (item groups)

## Context

Since ADR-062, items have live sheets of their own, but an actor's items sit outside its sheet: the actor list shows them in a disclosure, and no formula can read them. Systems need an inventory on the character sheet, equipped gear and prepared spells, bonuses from what is held (armour adding to AC, a feature adding to hit points), and rolls made with an item ("attack with this sword"). ADR-062 left an `@items` join for this, and kept items out of the actor document.

A first draft let actor formulas query items by type with a filter, such as `sum(@items.armor[equipped].acBonus)`. It was dropped for the design below:

- the actor's formula had to name every item type that adds to a value, so a new type (a ring, a shield) meant editing actor formulas;
- a filter could sum a secret field into a value players see.

## Decision

1. **State is plugin data.** Equipped, attuned, carried, prepared, quantity and charges are fields of the plugin's item types, such as `"equipped": { "type": "boolean" }`. The core adds no flag of its own, and the fields are edited in the item's document like any other (ADR-062).
2. **Item types declare what they contribute; actor formulas read the totals.**
   - An item type may declare `contributes`: named values, each a `formula` over the item's own data and derived values, combined over the actor's items by `combine`:

     ```json
     "contributes": {
       "hpBonus": { "formula": "@active ? @hpBonus : 0", "combine": "sum" },
       "preparedSpells": { "formula": "@prepared", "combine": "count" }
     }
     ```

   - Actor formulas read the combined value as `@items.<name>`, such as `"maxHp": "@hp.base + @items.hpBonus"`. They never loop over items, and need not know which types contribute.
   - **Combines:**
     - `sum` (the default), `max` and `min` combine numbers;
     - `any` is true when one item's formula is true;
     - `count` counts the items whose formula is true.
   - **With no contributing items:** `sum` and `count` give 0 and `any` gives false. `max` and `min` take the `default` they must declare.
   - **One name, one meaning.** Item types contributing the same name must agree on `combine` and on the value type (number for `sum`, `max` and `min`; boolean for `any` and `count`). The validator reports a mismatch on each file.
   - **Validation:** the validator gathers every contributed name and checks `@items.<name>` in actor formulas as it checks `@derived.<name>`.
   - **No cycles.** Contribution formulas read their own item only, never the actor or `@items`, so an actor cannot depend on itself through an item. `@items` is refused in item formulas.
   - **No leaks.** Contribution formulas, and the item derived values they read, may use main-layer fields only. A secret field could otherwise reach a player through a total.
   - **Which items count:** the actor's own items outside the trash, whose type the system still declares. Each item's data comes from its live document when loaded, else its stored state, else the projection.
   - **Where totals are read:**
     - `@items` is allowed in actor types' derived values, `visibleIf`, recipes, outcomes and card rows.
     - The server computes the totals for rolls, combat and plugin code, and the SDK gives plugin code the totals rather than the items.
     - An actor holds at most 500 items.
   - **What contributions cannot do:** read one particular item, which is what `@item` in rolls is for.
3. **`items` sheet node.**
   - It lists the actor's owned items of `itemTypes` (all types when omitted), grouped by item group and ordered by name. Each row is laid out by `item`, as `list` lays out array rows.
   - Paths inside `item` are relative to the item's data, and are checked against every listed type unless a `visibleIf` on `@item.type` guards them.
   - `@item.name`, `@item.type` and `@item.id` name the row's item.
   - Row inputs write to the item's live document. The sheet opens the main documents of the items it needs on one socket of its own. Access is the item's (§9.3), and an item's secret fields stay on its own sheet.
   - The core draws open, remove and add. Add offers the library's items of those types, and library or compendium rows can be dropped onto the node.
   - The open item documents also feed the contributions in the browser, so ticking "equipped" or "active" changes the actor's derived values at once.
4. **`@item` in rolls.**
   - A recipe rolled from an `items` row, or from an owned item's own sheet, reads that item as `@item`.
   - Recipes that use it declare `"item": [<types>]`, which the validator checks reads against.
   - The roll request carries `itemId`, and the server checks that the item belongs to the rolling actor.
   - Library items have no holder, so their sheets still roll nothing.
5. **Core API.** These keys are additive. Plugins that use them declare a `coreApi` range that includes the version shipping them; the core's own API version is raised with the release.

## Consequences

- tiny-d20 gains armour that contributes to AC while equipped, attacks with its weapons, and prepared spells counted through a contribution (T-1208).
- A new kind of item (a feature, a ring) adds to an actor's values by declaring contributions, without touching actor types. Item groups (ADR-061) show it under its own heading, such as "Features".
- No formula can list or filter items. A system that needs a value from items declares it as a contribution.
- A sheet with many items opens many small documents on one socket. The 500-item limit bounds it, and the documents unload when the sheet closes (§9.6).
- Plugin code reads the same totals; an SDK accessor for them is added with T-1205.
