# ADR-050: Initiative, turn ordering and combat hooks

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0802
- **Covers:** FR-COMBAT-02
- **Refines:** ADR-049, ADR-047

## Context

ADR-049 ordered combatants by initiative typed by the GM. FR-COMBAT-02 has the plugin's `combat.json` roll initiative and pick an ordering rule (`desc`, `asc` or `sideBased`), or a code hook order the turns. `onTurnStart` (§8.10) was declared in 0.1.0 but never called. Combatants have no "side".

## Decision

1. **Rolling.** `POST /tables/:id/encounter/initiative` rolls `combat.json`'s `initiative` for every combatant without initiative, or for the ids given. It rolls against the combatant's actor (its live data, with the GM's view) and the system's shared functions. Free-form combatants roll without data; when the formula needs data, they are skipped and the GM types theirs. Each roll is a chat message spoken by the combatant, to everyone, or to GMs and assistants when the combatant is hidden. A system without a formula answers `422 no_initiative`.
2. **Sides.** A combatant's side is its actor type's `controlledBy` (`player` or `gm`); free-form combatants are on the GM's side. No new field.
3. **Rules.** `desc` (the default) is highest first, `asc` lowest first; combatants without initiative always go last, and ties go in adding order. `sideBased`: the side with the best roll acts first, then the other, each highest first; the players' side wins a tie.
4. **Stored order.** After every change the order is worked out again and stored as `combatants.position`. The turn, a combatant id (ADR-049), does not move when the order changes.
5. **`orderCombatants` hook.** When the system's `code/server` has `hooks.orderCombatants`, it receives every combatant (id, name, initiative, hidden, side, adding order, actor with data) and returns their ids in turn order. It replaces the rule. Any other answer, a failure or a timeout falls back to the rule, with a warning in the log.
6. **`onTurnStart` hook.** It runs when the turn passes to a combatant: on start and on "next turn", not when the GM steps back. It gets the combatant, its `actor` and the `round`. It acts as the GM who moved the turn, speaking as the combatant's actor, so `ctx.roll` reads that actor; its messages go to GMs and assistants only when the combatant is hidden. A failure is logged and the turn stays moved.
7. **Hooks return values.** The worker sends back what server code returns, so hooks can answer; handlers and commands still answer by posting.

## Consequences

- Both reference plugins roll initiative (`tiny-d20`: `desc`, `tiny-pool`: `sideBased`).
- An ordering hook runs on every change to the encounter, within the 5-second limit of server code.
- Plugins decide what a turn start does (regeneration, reminders) without the core knowing their rules.
- A GM cannot put a combatant on the other side; a side field can come later if systems need it.
