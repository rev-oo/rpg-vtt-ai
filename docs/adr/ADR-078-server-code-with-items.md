# ADR-078: Server code with items, formula bounds and `then`

- **Status:** Accepted
- **Date:** 2026-11-10
- **Tasks:** T-1610
- **Covers:** FR-PLUGIN-10, FR-SHEET-08
- **Builds on:** ADR-047 (plugin server code), ADR-063 (items and their totals), the T-1609 roll options

## Context

The D&D 5e study (`docs/studies/dnd5e-srd.md`, F6, F7 and F16) found that server code could not work with items, read derived values or change anything but actor counters, and that counter bounds were fixed numbers. Casting a spell could not spend its slot, a Long Rest could not recharge features (they live on items), and healing could pass the maximum. Spending a slot is the hard case: the Cast roll is a formula recipe with a card, outcomes and a slot option, none of which a handler recipe has.

## Decision

1. **Formula bounds on counters.** A counter's `minimum` and `maximum` may be formulas. They read the entity's data (both layers, on the server), `@derived`, `@items` for actors and `@settings`, with the system's shared functions, and are worked out on every step: steps from sheets (the collab `adjust` message), steps from server code, and values typed on a sheet. Number bounds still hold everywhere. Checks that have no entity (stored data repair, the validator's defaults, pack data) skip formula bounds. A formula that fails bounds nothing, rather than blocking the counter. Only counters take them: the validator refuses a formula bound on any other field (`formula_bound`), since only counters are stepped where the bound can be enforced.
2. **Handlers get more.** Handler recipes take `item`, checked like a formula recipe's. A handler's input gains `derived` and `totals` (what `@derived` and `@items` read), `items` (the actor's held items, each with its derived values) and `item`. All are worked out from what the roller may see, with the same rules `ctx.roll` uses.
3. **Two new `ctx` calls.** `ctx.items.adjust(id, path, delta)` steps an item's counter, for an item the roller may edit (held by an actor they own, or a library item for GMs and assistants). `ctx.actors.set(id, path, value)` sets a text, number or boolean field that is not a counter, nor shared text, of an actor the roller owns; the value must fit the field. Both reach secret fields only for GMs and assistants, like `ctx.actors.adjust`, and change the live document through a direct connection, so open sheets see the change.
4. **`then` on formula recipes.** A formula recipe may name a handler in `then`. It runs after the recipe's card is posted, with the handler input plus `options` (as `@options` read them) and `result` (total, matched outcome label, rolls). It may post nothing; what it posts follows the card. The card stays whatever happens: a `ctx.fail` message is posted as text, other failures are logged, and a missing handler is a warning.

## Consequences

- `srd5` spends the slot a spell is cast with (`then` on Cast), bounds slots by `@derived.slots<n>`, Hit Points by `@hp.max` and Hit Dice by `@level`, and recharges features on a Long Rest.
- Because `then` runs after the roll is posted, it cannot stop the roll: a cast with no slot left still shows its card, followed by the plugin's message. The alternative, handler recipes that roll other recipes and post their cards, would refuse before rolling but adds a recipe-rolling `ctx` call to the frozen API. The user chose `then`.
- Bounds are not stored data rules: a typed value can still pass a formula bound when the entity changes afterwards (lowering `hp.max` leaves `hp.value` as it was until the next step).
- The collab server loads a system's shared functions to work out bounds, so a step on a plugin with code may wait for its worker to start.
