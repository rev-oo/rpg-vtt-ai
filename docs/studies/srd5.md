# Study: D&D 5e from the SRD 5.2 as a system plugin (T-1605)

`plugins/srd5` is a game system built from the [System Reference Document 5.2](https://www.dndbeyond.com/srd) (CC-BY-4.0). It has characters and creatures with abilities, skills, saving throws, proficiency, attacks, spells and slots, conditions, rests, and an SRD pack. It uses only what the plugin format offers: JSON types, sheets, rolls, cards and a pack, plus `code/shared` (formula functions) and `code/server` (handlers). It has no client code and no styles. This study records what was missing, what needed a workaround, what was rough, and what needed reading the app's code rather than the [authoring guide](../plugin-authoring.md). It ends with proposed follow-up tasks and the questions left for the user.

## How the plugin works

- **Character** (`types/actors/character.json`): class (one of the 12), level, species, background, the six abilities, saving throw proficiencies, 18 skills (not proficient, proficient or Expertise), Hit Points (current, maximum, temporary), Hit Dice spent, death saves, Heroic Inspiration, speed, spell slots spent per level, coins, conditions and Exhaustion, portrait, biography, notes and secret GM notes.
- **Derived values** do the rules: modifiers, Proficiency Bonus from level, every save and skill bonus, Initiative, Passive Perception, Armor Class (armour, shield, and the barbarian's and monk's Unarmored Defense), Hit Die by class, spellcasting modifier by class, spell attack and save DC, cantrip dice by level, and the slots of each level from the class tables. Exhaustion takes 2 per level from every D20 Test bonus.
- **Advantage and Disadvantage**: a "Next d20 rolls" select on the sheet (Normal, Advantage, Disadvantage) plus the conditions that always apply one (Poisoned, Blinded, Prone, Restrained, Invisible) give three derived edges: checks, saves and attacks. Every d20 is `(edge == 0 ? 1d20 : edge > 0 ? 2d20kh1 : 2d20kl1)`.
- **Items**: weapons (dice, die, versatile die, finesse, ranged, mastery, magic bonus), armour (light, medium, heavy or shield, contributing base AC, a Dexterity cap and a heavy flag), adventuring gear, spells (level, school, components, attack or save, effect dice, healing or damage type) and features (uses and recharge). Weight is a contribution, so the Inventory tab totals it.
- **Rolls** (`rolls.json`, 43 recipes): a check and a save per ability, a check per skill, weapon attack, damage and critical damage, Unarmed Strike, spell cast and effect, creature attack, damage and critical damage, and three handlers.
- **Server code** (`code/server.ts`): `deathSave` (natural 20 back at 1 HP, natural 1 two failures, three of either ends it), `spendHitDie` (rolls the class's Hit Die plus Constitution and heals) and `longRest` (all HP, Hit Dice and slots back, temporary HP gone, Exhaustion down by 1). They roll, then step the actor's counters with `ctx.actors.adjust`.
- **Shared code** (`code/shared.ts`): `slots(class, level, slotLevel)` (full casters, half casters at half level rounded up, and Pact Magic), `damage(count, die, bonus)` (`1d8 + 3`) and `saveText(ability, dc)` (`Dexterity DC 13`). The class tables live in `code/src/tables.ts`, which the server code imports too.
- **Creatures** (`types/actors/npc.json`): a stat block with the abilities, a Proficiency Bonus, AC, HP, the save proficiencies, text lines (skills, senses, languages, defences), traits, and actions as a collection whose rows roll attack and damage with `@actions[@args.id]`.
- **SRD pack** (`packs/srd.json`, 58 entries): 19 weapons, 13 armours, 7 pieces of gear, 12 spells and 7 creatures (Goblin Warrior, Skeleton, Zombie, Wolf, Bandit, Guard, Ogre).
- **Attribution**: the manifest's description and a `LICENSE.md` carry the SRD's CC-BY-4.0 attribution. The plugin is named "SRD 5.2 (fifth edition)", without the D&D trademark (see D1).
- **Generated files.** The JSON (sheets, types, rolls, cards, pack and `lang/en.json`, 372 keys) was written by a script, because so much of it repeats (see F10). The script is not committed (see Q1).
- **Tests.** `code/` is a workspace package, like dice-3d's, with unit tests for the class tables and the handlers (with a fake `ctx`). The schema and CLI suites treat it as a reference plugin. `e2e/tests/srd5.spec.ts` makes a level 5 wizard, copies a longsword and Fire Bolt from the pack, attacks, casts, spends a slot and takes a Long Rest.

## Findings

Each finding is a gap (the format lacks it), a workaround (done another way), or a rough edge (it works but is awkward).

### F1. A die's size cannot come from data (workaround)

The die size is part of the dice token (`d8`), so only the count can be a formula (`(@n)d8`). Weapons and spells store their die as an integer enum (4, 6, 8, 10, 12), and every damage formula is a chain over the sizes:

```text
(@item.derived.die == 4 ? (@item.dice)d4 : @item.derived.die == 6 ? (@item.dice)d6 : … : (@item.dice)d20)
```

A damage expression such as `2d6 + 1d4`, or a weapon with two damage types, cannot be stored at all. Critical damage doubles the count (`@item.dice * 2`), which the chain allows.

### F2. The resolved formula prints every branch of a conditional (rough edge)

`@roll.resolved`, which the default message and the cards show, keeps the untaken branches with their references (`substitute` in `packages/formula/src/evaluate.ts`). A longsword's damage reads in the chat as:

```text
(10 == 4 ? (@item.dice)d4 : 10 == 6 ? (@item.dice)d6 : 10 == 8 ? (@item.dice)d8 : 10 == 10 ? 1d10 : @item.derived.die == 12 ? (@item.dice)d12 : (@item.dice)d20) + (false ? @derived.dexMod : false ? max(@derived.strMod, @derived.dexMod) : 3) + 0
```

Together with F1 and F3, every attack and damage roll is unreadable in the chat. Only the dice list ("Dice of 1d10") and the total are clear.

### F3. Nothing can be chosen when rolling (gap)

A roll button's `args` are fixed in the sheet, so a player cannot choose, at the moment of rolling, Advantage or Disadvantage, the slot level of a spell (upcasting), a situational bonus (Bless's 1d4, a cover bonus), or the DC of a Concentration save. The workaround for Advantage is the "Next d20 rolls" field on the sheet: it is stored, so it stays until changed, and everyone editing the sheet shares it. Upcasting and situational bonuses have no workaround; the player rolls the extra dice by hand in the chat.

### F4. Outcomes cannot see the dice (workaround)

Outcomes and cards read `@total`, `@roll.expression` and `@roll.resolved`, not the dice (`rollValues` in `packages/plugin-engine/src/recipes.ts`). A critical hit is a natural 20, so the attack's outcome subtracts the whole bonus again: `@total - (<attack bonus>) == 20`. With no way to name a value in a recipe, the attack bonus is written three times (formula and two outcomes), and its ability part a fourth time in the card. Server code does see the dice (`HandlerRoll.dice`), which is how the death save finds its natural 20.

### F5. One recipe makes one roll (gap)

An attack and its damage are two buttons and two chat messages, and the critical damage is a third button the player must choose after seeing the attack. A handler could roll both and double the dice on a 20, but handlers cannot be made with an item (F6).

### F6. Server code cannot work with items (gap)

`handler` recipes have no `item` key (`handlerRecipeSchema` in `packages/plugin-schema/src/rolls.ts`), and formulas in an `items` row read only `@item.id`, `@item.name` and `@item.type` of the item, so a row's `args` cannot pass the item's data to a handler either. `ctx` has no way to read the actor's items. So nothing item-based can run as code: casting a spell cannot spend its slot (slots are a counter the player steps by hand), an attack cannot roll its damage, and a potion cannot heal.

### F7. Server code sees stored data only, and changes only actor counters (gap)

A handler gets the actor's data, without derived values or item totals, so `spendHitDie` cannot read `@derived.hitDie` and `longRest` cannot read the slots of each level. Both import the class tables from `code/src/tables.ts`, which `shared.ts` also uses; the bundler copies them into both files. (Another workaround: `ctx.roll('@derived.hitDie')` returns a derived value as a roll that is never posted.) `ctx.actors.adjust` changes actor counters only, so a Long Rest cannot recharge a feature's uses, which live on items, and cannot set a value that is not a counter.

### F8. Item recipes are checked against every actor type (workaround)

A recipe made with a spell is checked against each actor type that might hold one, so `spellCast` failed validation for creatures, which have no spellcasting modifier. Creatures got `spellSaveDc` and `spellAttackBonus` fields and derived `spellMod`, `spellAttack`, `spellDc` and `cantripDice` only to validate. There is no way to say which actor types a recipe is for.

### F9. Formulas have no tables or lists (workaround)

Spell slots by class and level, Hit Dice by class and the spellcasting ability by class are tables. Slots went into shared code (`slots()`); Hit Die and spellcasting modifier are chains of conditionals in derived values. Shared code works well for this, but it makes a plugin "with code", which admins must acknowledge, for what is plain data.

### F10. Repetition (rough edge)

Each of the 18 skills needs a field, a derived value, a recipe (so its chat label can be translated: a recipe's `label` is fixed and `args` cannot name the roll), a select, a status and a button, each with a lang key. The six abilities need the same for checks and saves, and the nine slot levels for slots. In all: 43 recipes, 372 lang keys, a character type of about 550 lines and a character sheet of about 1,500. Writing them by hand was not practical, so a script generated the JSON. Sheets have no repeat over a list, recipes take no parameters in their labels, and there are no reusable sheet fragments (the ability block and the conditions are written out for both actor types).

### F11. Translation leaks (gap)

- **Select options** show a translated label only when the stored value is itself a lang key (as dice-3d's F5 found for settings). Class, school, proficiency, armour kind and roll mode store keys such as `class.wizard` and `prof.expertise`, which formulas then compare (`@class == 'class.wizard'`). Damage types store plain words (`slashing`), since they also appear in cards, so their select is English only.
- **Card rows** show values as they are (`CardMessage.tsx`), so `@item.damageType` and `saveText()` are English in every language.
- **Server code** has no lang files, so the rest and death save messages are English.

The plugin is English only for now (see Q3).

**Since T-1611 (ADR-081):** damage types keep plain values with `enumLabels`, card rows translate values that are lang keys (so `saveText()` is gone), and the server code posts by lang key. The plugin ships pt-BR.

### F12. Formulas cannot turn numbers into text (workaround)

`+` joins two texts only, and there is no text function, so a card cannot show "1d8 + 3 slashing" from data. Shared code adds `damage()` and `saveText()`.

### F13. Rolls know nothing of their target (gap)

An attack cannot compare to the target's AC, a save spell cannot ask the targets to save, and damage cannot be applied to a creature's Hit Points. The card says "On a hit: 1d8 + 3 slashing" and the GM does the rest. Tokens on the map can be selected, but recipes cannot read a selection.

**Since T-1615 (ADR-082):** weapon, unarmed and creature attacks target the tokens the player targets and show Hit or Miss against `@target.derived.ac`; their cards apply the damage, or half, to each target. Saving throws for the targets and temporary Hit Points stay with the players.

### F14. Conditions stay on the sheet (gap)

Conditions are booleans that change the actor's own rolls (through the edges). Nothing shows them on the actor's token or in the combat tracker, and a condition cannot change other actors' rolls (Advantage on attacks against a Paralyzed creature).

**Since T-1615 (ADR-082):** both actor types show their conditions on tokens and in the combat tracker, with the plugin's own icons. Formulas can read a target's conditions (`@target.conditions.paralyzed`), so Advantage against a Paralyzed creature is now possible; the plugin does not use it yet.

### F15. Rows in an items list cannot vary by item (rough edge)

`visibleIf` in an `items` row reads the actor, not the item, so the Spells tab cannot hide "Cast" for spells with no roll, and the Attacks tab cannot show "Two hands" only for versatile weapons. The item's own sheet can (its formulas read the item), but the row is where players roll.

### F16. Counter bounds are fixed (rough edge)

`hp.value` is bounded by the schema's `maximum` (999), not by `hp.max`, and spent slots by 4, not by the slots the character has. So `+` can spend slots a character does not have, and healing can pass the maximum; `spendHitDie` caps healing itself. Slots are stored as **spent**, which is what makes a Long Rest simple: it sets each to 0 without knowing the maximum.

### F17. Packs: ids, collections and attribution (rough edge)

- Entry ids are unique across kinds in a pack, so the Shield spell is `shield-spell` next to the Shield armour.
- Collections are lists of rows in packs and defaults, but maps of rows keyed by id in stored data, `setActorData` in the e2e helpers, and the `migrate` hook. The first pack failed validation for using maps.
- There is no place for attribution. CC-BY-4.0 requires it; it went into the manifest's `description` and a `LICENSE.md`, which `pack` ships (any non-JSON file outside `code/` is kept) but the app never shows. The Compendium does not say where its entries come from.

### F18. Tooling (rough edge)

- The lint boundaries assumed plugin code is client code (`plugin-code` allows only `@vtt/sdk/client`). Shared and server code import `@vtt/sdk`, so `packages/config/eslint/workspace.mjs` gained a `plugin-server-code` element (pure, `@vtt/sdk` only, no React, client SDK or Node built-ins).
- The server tests copy reference plugins without their code (`apps/server/test/support/reference.ts`), so a system whose formulas call its shared functions does not load there. srd5 is tested through unit tests of its code, the schema and CLI suites, and e2e.
- The SDK has no fake `ctx` for handlers; the unit tests build one (`code/test/rests.test.ts`).

### F19. What worked as documented

- Derived values carry most of the rules, and the sheet follows each edit at once: AC from armour, Dexterity cap and shield, the barbarian's and monk's Unarmored Defense, Exhaustion in every bonus, spell DC and attack.
- Item contributions with `max`, `min` and `any` express armour precisely (the best armour, the lowest Dexterity cap, any heavy armour).
- Item derived values (`die`, the versatile die when held in two hands) are read by recipes as `@item.derived.die`.
- Rolls made with an item, from an `items` row, read the item live: ticking "Two hands" changes the next damage roll.
- Collections with `@actions[@args.id]` make a creature's actions work as a stat block.
- Handlers with `ctx.actors.adjust` handle rests and death saves well, and `HandlerRoll.dice` gives the natural d20.
- Shared code runs the same class tables in the browser and on the server.
- The compendium copies pack items onto a character in one click.

## What needed reading the code

| Question                                                         | Answer                                                                                       | Source                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Can a die's size be a formula?                                   | No: the size is part of the dice token; only a `(count)` touching the `d` can be one         | `packages/formula/src/lexer.ts`, `parser.ts` (`group`) |
| What does `@roll.resolved` print for a conditional?              | Every branch; untaken ones keep their references                                             | `packages/formula/src/evaluate.ts` (`substitute`)      |
| What can outcomes and cards read of a roll?                      | `@total`, `@roll.expression`, `@roll.resolved`; not the dice                                 | `packages/plugin-engine/src/recipes.ts` (`rollValues`) |
| Can a handler recipe take an item?                               | No: a handler recipe has only `label` and `handler`                                          | `packages/plugin-schema/src/rolls.ts`                  |
| What does a handler's `actor.data` hold?                         | The live data the roller may see, without derived values or items                            | `apps/server/src/domain/rolls.ts` (`view`, `liveData`) |
| What can `ctx.actors.adjust` change?                             | Counters of actors the roller owns, within the schema's bounds; the secret layer too for GMs | `apps/server/src/domain/rolls.ts` (`adjust`)           |
| Does a select translate its options?                             | Only options that are lang keys                                                              | `packages/sheet-renderer/src/fields.tsx`               |
| Are card row values translated?                                  | No, they are shown as computed                                                               | `apps/web/src/plugin-host/CardMessage.tsx`             |
| Which actor types is a recipe made with an item checked against? | Every actor type                                                                             | `vtt-plugin validate`                                  |
| Do non-JSON files outside `code/` reach the archive?             | Yes (`LICENSE.md`); only dot files, `node_modules` and the code sources stay behind          | `packages/plugin-io/src/archive.ts`, `plugin-cli` pack |

## Proposed tasks

For the user to approve; approved ones join M16.

| ID  | Task                                                                                                                                                                                                                                                                             | From    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P1  | **Readable resolved formulas.** `@roll.resolved` prints only the branch a conditional (or `if`) took, with its values.                                                                                                                                                           | F2      |
| P2  | **Dice from data.** Let a die's size be a formula, such as `(@item.dice)d(@item.die)`, and let a text field hold a dice expression that a formula rolls (`roll(@item.damage)`), checked when it is saved.                                                                        | F1      |
| P3  | **Roll options.** A recipe declares options the app asks for when its button is pressed (a choice such as Advantage, a number such as a slot level, a bonus such as `1d4`), read as `@options.<name>`; with shortcuts (Shift for Advantage, Ctrl for Disadvantage) and defaults. | F3      |
| P4  | **Dice in outcomes, and named values.** Outcomes and cards read the kept dice (`@roll.dice[0].kept`, or `@natural` for the first d20); a recipe can name values (`let`) that its formula, outcomes and card share.                                                               | F4      |
| P5  | **Recipes with several rolls.** A recipe rolls named formulas in order (attack, then damage, doubled on a critical) into one card.                                                                                                                                               | F5      |
| P6  | **Server code with items and derived values.** Handler recipes take `item` like formula recipes; handlers get the item and the actor's derived values and item totals; `ctx.items.adjust` steps an item's counters, and `ctx.actors.set` sets a non-counter field.               | F6, F7  |
| P7  | **Recipes for some actor types.** A recipe can list the actor types it is for (`actors: ["character"]`); the validator checks it against those only, and buttons elsewhere are refused.                                                                                          | F8      |
| P8  | **Labels for values.** `enumLabels` on type fields (and settings, with dice-3d's P5); card rows translate values that are lang keys; server code posts text by lang key with parameters, so each viewer reads it in their language.                                              | F11     |
| P9  | **Text in formulas.** Built-in `text(x)` and `signed(x)`, and joining text with numbers.                                                                                                                                                                                         | F12     |
| P10 | **Item rows that read the item.** Formulas in an `items` row read the row's item as `@item.<field>`, so `visibleIf` and `args` can depend on it.                                                                                                                                 | F15, F6 |
| P11 | **Bounds from data.** A counter's `maximum` (and `minimum`) may be a formula, such as `@hp.max`, checked on every step.                                                                                                                                                          | F16     |
| P12 | **Attribution.** A manifest `attribution` (text and a link), shown on the Plugins page and in the Compendium; packs accept collections in the stored form too.                                                                                                                   | F17     |
| P13 | **Testing system plugins.** A fake `ctx` and a formula harness in the SDK (`@vtt/sdk/testing`, alongside dice-3d's P7), and server test support that loads a reference plugin's compiled code.                                                                                   | F18     |
| P14 | **Targets.** Rolls may carry the viewer's selected tokens as targets; recipes read `@target` (such as its AC); cards offer "apply damage" to the targets for those who may edit them.                                                                                            | F13     |
| P15 | **Token statuses.** An actor type declares boolean fields as statuses with an icon; tokens and the combat tracker show the ones that are on.                                                                                                                                     | F14     |

P1 is small and fixes what every player sees. P3, P4, P6 and P7 add keys to the plugin format, so they are best decided before the API freeze (T-1701), though each is additive and could come in a 1.x minor version. P14 and P15 are large and belong after 1.0 unless the user wants combat automation in 1.0. F9 and F10 need no task of their own: P2, P3 and P8 remove most of the repetition, and the rest is what a system's data costs.

## Decisions

- **D1. No D&D trademark in the name.** The SRD's licence covers its text, not Wizards of the Coast's trademarks, so the plugin is "SRD 5.2 (fifth edition)". Its id was `dnd5e-srd`, from the task, until T-1614 renamed it `srd5` (Q2).
- **D2. The 2024 rules, as the SRD 5.2 has them.** A Long Rest restores all Hit Dice, Exhaustion takes 2 per level from D20 Tests, paladins and rangers cast from level 1, and weapons have a mastery (stored as text: its effects are not automated). The healing from a Hit Die is at least 1.
- **D3. One class per character.** Multiclassing would need a collection of classes, slots from the combined caster level and Hit Dice per class. It is left out of the study.
- **D4. Slots and Hit Dice are stored as spent.** The maximum then comes from the class tables, and a Long Rest sets the spent counters back to 0.
- **D5. The pack is a sample.** 58 entries cover each item type and a range of creatures. Their numbers and texts were transcribed by hand from the SRD 5.2 and should be checked against the published document before the plugin ships beyond this study.

## Questions for the user

- **Q1.** The JSON was generated by a script that is not in the repository. Should it be committed (for instance as `plugins/srd5/code/generate.ts`, which `pack` leaves out), so the plugin is edited through it, or should the JSON stay the source and be edited by hand?
- **Q2.** Keep the id `dnd5e-srd`, or rename it to something without "dnd" (such as `srd5`) before any table uses it? **Answered:** renamed `srd5` in T-1614.
- **Q3.** Should the plugin have a pt-BR translation now, or wait for P8 so values and server messages can be translated too? **Answered:** it waited for P8, and ships pt-BR since T-1611.
- **Q4.** Which of P1–P15 join M16?
