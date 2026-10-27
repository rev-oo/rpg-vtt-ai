# ADR-049: Combat encounters are rows, refetched on `combat.updated`

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0801
- **Covers:** FR-COMBAT-01, FR-COMBAT-03, FR-COMBAT-04
- **Decides:** Q14

## Context

M9 adds a combat tracker. Q14 asked whether an encounter is stored as rows changed through REST, or as a Yjs document like sheets (ADR-030).

Turns are driven by the GM: one person presses "Next turn", and nobody co-edits an encounter. Players must also never receive hidden combatants (FR-COMBAT-04), and a Yjs document reaches every subscriber whole, so it could not hold them.

## Decision

1. **Rows.** A table has at most one encounter: `encounters(id, table_id unique, round, current_id)` and `combatants(id, encounter_id, actor_id?, name, initiative?, hidden, sort)`. Ending an encounter deletes it with its combatants. `round` is 0 until the encounter starts.
2. **Turn order** is computed, never stored: highest initiative first, combatants without one last, ties in adding order. T-0802 adds the plugin's ordering rules.
3. **The turn is a combatant id**, not an index, so adding, removing or reordering combatants keeps it. "Next" past the last combatant starts a new round; "previous" from the first goes back to the previous round's last, never before round 1. Removing the combatant whose turn it is passes the turn to the next one.
4. **Endpoints**, under `/api/v1/tables/:id/encounter`: `GET` for every member; `POST` and `DELETE` (create, end), `POST /combatants`, `PATCH`/`DELETE /combatants/:combatantId`, `POST /start` and `POST /turn {direction}` for GMs and assistants (`canRunCombat`). Each change answers with the encounter as the caller sees it.
5. **A payload-less `combat.updated` event** goes to the table's subscribers after each change, and clients refetch, as with `table.updated` (ADR-039). The server filters each member's view, so nothing hidden is on the socket.
6. **Visibility.** Players never receive hidden combatants, nor the current turn while a hidden combatant has it (`currentId: null`). A combatant's `actorId` is sent only to members who can see that actor; its name, chosen by the GM, is always sent.

## Consequences

- A turn costs one event and one `GET` per member; encounters are small, so this is cheap.
- Hidden combatants and hidden actors cannot leak through the event stream.
- One encounter per table; several prepared encounters would need a list later.
- Combatants keep their own name, so renaming an actor does not rename it in a running encounter.
