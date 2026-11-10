# ADR-082: Targets and token statuses

- **Status:** Accepted
- **Date:** 2026-11-10
- **Tasks:** T-1615
- **Covers:** FR-MAP-03, FR-COMBAT-03, FR-CHAT-06, FR-PLUGIN-05
- **Builds on:** ADR-025 (recipes and cards), ADR-068 (tokens), ADR-078 (counters bounded by formulas)

## Context

The 5e study (`docs/studies/srd5.md`, F13 and F14) found that rolls know nothing of what they are aimed at, and that conditions stay on the sheet:

- An attack cannot compare its total with the target's Armor Class, and its damage cannot be applied to the target's Hit Points: the card says "1d8 + 3" and the GM does the rest.
- A creature's conditions (Prone, Poisoned…) show neither on its token nor in the combat tracker.

## Decision

1. **Members target tokens.**
   - Each member marks tokens of actors as targets on the map: the token's menu and the token list offer "Target", and T targets the selected token. Targets are marked with a red ring.
   - Targets are the member's own and stay on their page. They are not the selection: you select your own token to move it, and target the creature you attack.
   - Targets are not stored or shared. Tokens that leave the scene, or that the member no longer sees, stop being targets.
2. **Recipes declare `target`.**
   - A formula recipe lists the actor types it may target: `"target": ["character", "npc"]`. Rolling it sends the member's targets, in the order they were targeted (at most 20).
   - The server takes only tokens of the table that the roller sees on the map, standing for an actor of one of those types. Anything else answers `unknown_target`, so hidden tokens cannot be probed. A recipe without `target`, or a handler recipe, refuses targets (`bad_target`).
   - Formulas, named values, outcomes and the card read the first target as `@target`: its fields with defaults, `@target.derived.*`, `id`, `name` and `type`. `@targets` is how many there are. `@target` exists only when `@targets > 0`; `?:`, `and` and `or` read only what they need, so `@targets > 0 and @total >= @target.derived.ac` works without a target.
   - Rolls never read a target's secret fields, whoever rolls, so a player's attack reads what the GM's would. The validator checks `@target` against each targeted type without its secret fields, and drops derived values that read them.
   - The card keeps the targets as they were: token, actor, name, and the actions done to each.
3. **Cards offer actions on the targets.**
   - A card's `apply` lists buttons such as "Apply damage": a counter of the targets (`hp.value`) and an amount, a formula worked out when the roll is made (`-@rolls.damage.total`). The amount must be a whole number; an action whose formula fails is not offered.
   - Only cards of recipes that target may have actions, and the field must be a counter in the main layer of each targeted type.
   - The card shows each target with the actions, for members who may edit that actor. `POST /messages/:id/apply` steps the counter within its bounds, as plugin server code does (ADR-078). Each action is done once per target: it is marked done before the counter moves, so two clicks cannot both apply it. The updated card reaches the message's audience (`chat.updated`).
4. **Actor types declare statuses.**
   - `"statuses": [{ "field": "conditions.prone", "label": "condition.prone", "icon": "icons/prone.svg" }]`: true/false fields, not in lists, with an image of the plugin (SVG, PNG, JPEG, GIF, WebP or AVIF).
   - Token and combatant views carry the statuses that are on, read from the actor's stored data as the member may see it: a secret field's status shows only to GMs and assistants. Tokens draw up to four icons along their top edge; the token list and the combat tracker name them.
   - When a sheet change is stored and turns a status on or off, the server sends `token.updated` for the scenes with the actor's tokens, and `combat.updated` if it fights, so members refetch them. Statuses thus follow the sheet after the store debounce (2 s).

## Consequences

- srd5's weapon, unarmed and creature attacks target characters and creatures and show Hit or Miss against `@target.derived.ac` (creatures gain an `ac` derived value). Attack cards apply damage or half of it; a new `spellEffect` card applies a spell's damage, or its healing. Both actor types show their 14 conditions on tokens with the plugin's own icons.
- Damage goes to Hit Points only: temporary Hit Points, resistances and saving throws stay with the players, as one counter per action cannot express them. Server code may do more in a later version.
- A roll against several targets compares with the first only; an attack on another creature is another roll. Area spells apply their damage to each target from one card.
- Statuses read stored data, so they lag a live sheet by the store debounce.
