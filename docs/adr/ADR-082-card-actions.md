# ADR-082: Card actions on the selected token

- **Status:** Accepted
- **Date:** 2026-11-11
- **Tasks:** T-1617
- **Covers:** FR-CHAT-06, FR-PLUGIN-05
- **Builds on:** ADR-025 (cards), ADR-068 (tokens), ADR-078 (counter bounds)

## Context

A chat card shows a roll but cannot act on it. In srd5, the GM read the damage off an attack card and typed the new hit points into the goblin's sheet. A spell that asks for a saving throw showed "Save: Dexterity, DC 14" as text, and each player rolled the save from their own sheet, with no link to the spell or its DC. The 5e study (`docs/studies/srd5.md`, P14) asked for cards that apply their damage. Targets (T-1615) come later, so the first step must work without them.

## Decision

1. **A card declares `actions`, at most six.** There are two kinds:
   - An **apply** action (`label`, `field`, `amount`) steps a counter.
   - A **roll** action (`label`, `roll`, `args`) rolls another recipe of the plugin.
   - Either may have `when`. The card offers the action only while `when` is true.
2. **The engine works them out when the roll is made.** `amount`, `args` and `when` are formulas with the scope of card rows. The message stores the results with the card (`card.actions`): the step as a whole number, rounded as `round()` does, and the arguments as scalars. A later change to the roller's sheet does not change a posted card. An amount or argument that fails keeps the action on the card, with its `error`, and the button is disabled.
3. **Actions act on the token the clicker has selected on the map**, except roll actions `for` the roller (point 5). The map shares its selection with the chat through a small store per table in the web app. The card names the selected token ("Acts on Goblin"), or asks the clicker to select one.
4. **Apply goes through `POST /messages/:id/apply` with `{ action, actorId }`.**
   - The caller must see the message and be able to edit the actor (owner access).
   - The table must be writable.
   - The step uses the same counter adjustment as server code (`ctx.actors.adjust`), within the counter's bounds, formula bounds included. It works on the main layer for players, and on the secret layer too for GMs and assistants.
   - The amount is the one the server stored with the card. The request names only the action's index, so the clicker cannot change the amount.
   - The change reaches every viewer through the actor's live document. The answer is the counter's new value, which the card shows to the clicker.
5. **Roll uses the existing roll endpoint.** The web posts the recipe with the stored `args` and the selected token's actor as the speaker. The server checks the roll as any other: the clicker must be able to speak as that actor, and the recipe must suit its type.
   - A roll action may say `"for": "roller"`. It then rolls for the actor that rolled the card, the message's speaker, and with the card's item when its recipe takes one: the message stores the item's id with the card (`card.itemId`). Only those who may roll for that actor see the button. This rolls an attack's damage after the attack, as at the table.
   - Only a roller action may name a recipe made with an item, on a card whose recipes are all made with items of types that recipe takes. The validator refuses others (`card_item_roll`, or `item_mismatch` for a type the recipe does not take).
   - Shift and Ctrl pick the choice that names them, as on a sheet. The server fills in the other options' defaults. The options dialog is not shown, because its formulas read the sheet that opened it.
6. **The validator checks actions.**
   - It checks their formulas against the scopes of the recipes that use the card.
   - An apply action's `field` must be a counter of some actor type: `unknown_field` if no type has it, `field_mismatch` if none has it as a counter.
   - A roll action's recipe must exist.

## Consequences

- srd5's attack and creature attack cards no longer roll damage with the attack. They offer **Roll damage** for the attacker, except on a natural 1, through new `weaponDamage` and `npcDamage` recipes; their `crit` argument, worked out from the attack, doubles the dice. Their damage cards offer **Apply damage** and **Apply half damage**. A spell attack offers **Roll damage** through `spellDamage`, which takes the slot the spell was cast with as `slot`. Its spell card offers both for damage, **Apply healing** for healing, and **Roll saving throw** for spells that ask for a save.
  - The save goes through a new `save` recipe. It takes the ability (`@args.ability`) and the DC (`@args.dc`), and its card shows Success or Failure against the DC.
  - `spellCast`, `spellEffect` and `spellDamage` name `@let.effect`, so the spell card offers to apply damage only on a roll that is the effect, and to roll damage only on the spell attack.
- Card actions do not show the options dialog, so a damage roll from a card takes no bonus dice; the clicker rolls extra damage, such as Sneak Attack, on its own.
- Damage goes to `hp.value` only. Temporary hit points, resistances and the saving throw's result are left to the clicker, who picks full or half damage.
- An action can be used more than once, on as many tokens as the clicker selects in turn. Targets (T-1615) will carry the card's actions to each target, once per target.
- Cards rolled before this change have no `actions`, and show no buttons.
