# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). While the version is 0.x, minor versions may break plugins and stored data.

## [Unreleased]

## [0.3.0] - 2026-10-29

Tables open as a full-page workspace, the compendium becomes a browser, and items get sheets of their own and a place on actor sheets: inventories, equipped and prepared state, bonuses in derived values and rolls made with an item. Plugins written for 0.1.0 and 0.2.0 work unchanged: the plugin core API stays at `0.1.0`.

### Fixed

- Items can be opened and edited. **Open** on a row of the items panel, or an item's name in an actor's items, shows the item's sheet as a panel, edited live like an actor's: GMs and assistants edit library items, and whoever owns an actor edits its items. Until now an item's system data could not be changed after it was created (FR-ENT-06, ADR-062).

### Added

- tiny-d20 has an inventory. Armour adds its bonus to the new Armour class while equipped, the Gear tab lists a character's weapons and armour with an Attack per weapon whose card shows the weapon's damage, and the Spells tab counts prepared spells. Its pack gains leather armour and chain mail. The plugin guide's tutorial gains an inventory step (ADR-063).
- Rolls can be made with an item. A recipe that lists item types in `item` reads the item as `@item`, such as a sword's bonus and damage, in its formula, outcomes and card. Its button sits in an item's row on the actor sheet, or on an owned item's own sheet, and rolls for the holder; the server checks that the actor holds the item. Library item sheets roll nothing (FR-PLUGIN-15, ADR-063).
- Actor sheets can show the actor's items. A system's sheet places an `items` node, and each item of the listed types appears there by name, grouped, with its fields edited in place: tick "equipped" and the actor's derived values follow at once, on every open copy. Each row opens the item's own sheet; whoever may edit the actor removes items there, adds them from the table's library, or drops items from the items panel or the compendium onto it. `item` is now a reserved field name (FR-SHEET-12, ADR-063).
- Items can add to their holder's numbers. An item type declares what it `contributes`, such as worn armour's bonus to defense, each with a formula over the item's own fields and how the items combine (`sum`, `max`, `min`, `any`, `count`). Actor formulas read the totals as `@items.<name>`, in derived values, rolls, initiative and plugin code, as soon as an item's sheet changes. The validator checks the names and keeps contributions off secret fields. An actor holds at most 500 items (FR-PLUGIN-15, ADR-063).
- Item types can declare a `group`, a plural label (`labelPlural`) and an `order`. The items panel, an actor's items and the compendium then show items under their groups, such as "Spells" and "Gear", with the compendium's actors first. Systems that declare no group keep a single list. Tiny D20 adds spells, in a "Spells" group, and two spells in its bestiary pack (FR-PLUGIN-11, ADR-061).

### Changed

- The compendium is a panel of the workspace that every member can browse. Search the system's pack entries by name, pack and type, preview each entry's sheet, and see which ones the table already has. GMs and assistants copy chosen entries into the table, and anyone copies items onto an actor they own. This replaces importing whole packs from the table settings, and `GET /tables/:id/packs` and `POST /tables/:id/packs/:name/import` are removed (FR-PLUGIN-09, ADR-060).
- A table opens as a full-page workspace. Lists, sheets, journal entries, the table overview, members, settings, combat, chat and dice are panels: drag them by their tabs to stack, split or float them, and close or reopen them from the Panels menu. Several sheets can be open side by side. A table now has a single URL, which panels do not change. Links to a table's sheets, journal entries, items, members or settings no longer work and lead to the tables list. Each browser remembers the layout per table, separately for phones, where every panel is a full-screen tab. Each list keeps its own search and filters, which are no longer part of the URL (FR-TABLE-08, ADR-059).

### Known limitations

- Plugin data is not migrated between system versions: sheets made with an older version show a notice, and fields the new version changed read as their defaults.
- Maps, tokens and assets are not available yet.
- The `vtt-plugin` CLI and the plugin SDK are not published to npm; build them from this repository.

## [0.2.0] - 2026-10-28

Plugins can run server code, and tables get combat, compendium packs, chat edits, sheet history and archiving. The image now runs on arm64 too. Plugins written for 0.1.0 work unchanged: the plugin core API stays at `0.1.0`.

### Added

- **Plugin shared and server code.** `code/shared` adds formula functions to sheets and rolls, and `code/server` runs `handler` roll recipes, which roll, post to the chat, read actors and adjust counters as the roller. Each plugin's code runs in a worker thread of its own with time limits, so a failing or looping plugin fails only its roll. The admin plugin page lists each plugin's code files.
- **Plugin slash commands.** `code/server` can declare chat commands, typed as `/name text` and posted to the chosen audience; `tiny-d20` adds `/check str` and `/check dex`. Commands and handlers can tell players what went wrong with `ctx.fail`.
- **Combat tracker.** GMs and assistants run an encounter beside the chat: add actors or free-form combatants, set initiative, begin, and pass turns through the rounds. Every member follows along live; hidden combatants, and whose turn it is while one acts, stay with the GM.
- **Initiative.** Systems with a `combat.json` roll initiative for every combatant from the tracker, into the chat, and order turns highest first, lowest first, or side by side. `tiny-d20` and `tiny-pool` roll initiative. Server code can order the turns with an `orderCombatants` hook and act at each turn's start with `onTurnStart`.
- **Compendium packs.** Plugins can ship `packs/*.json` of ready-made actors and items, checked against their types. GMs import a pack from the table settings; importing again adds only what the table does not have yet. `tiny-d20` ships a bestiary.
- **Chat edits and deletes.** Authors can edit or delete their text messages for 5 minutes, and GMs can delete any message. Changes show live to everyone who saw the message; edited messages are marked.
- **Sheet history.** A sheet's owners and GMs can open its history and restore how it was: a copy is kept every few minutes while it changes, the last 50 of each. Restoring changes the sheet for everyone at once, and can be undone. GM-only data has its own history, for GMs.
- **Table archive.** GMs can archive a table from its settings. An archived table is read-only for everyone (no edits, chat, rolls or new members) until it is unarchived, and the table list marks it.
- **Scheduled backups.** Set `BACKUP_DIR` and the server backs itself up every `BACKUP_INTERVAL_HOURS` (24 by default), keeping the newest `BACKUP_KEEP` (7). See `docs/backup.md`.
- **arm64 image.** The Docker image now runs on `linux/arm64` as well as `linux/amd64`, under the same tags.
- **System upgrades per table.** Installing a new version of a system no longer affects its tables until their GM upgrades them from the table settings; the table page says when one is available. Sheets made before an upgrade say which version they were made with, since plugin data is not migrated yet.
- **Long lists.** The actor, item and journal tabs load 50 entries at a time and the next ones as you scroll. The list endpoints take `limit` and `cursor` and answer `nextCursor`.

### Known limitations

- Plugin data is not migrated between system versions: sheets made with an older version show a notice, and fields the new version changed read as their defaults.
- Maps, tokens and assets are not available yet.
- The `vtt-plugin` CLI and the plugin SDK are not published to npm; build them from this repository.

## [0.1.0] - 2026-10-26

The first release: a self-hosted virtual tabletop where game systems come from plugins.

### Added

- **Self-hosting.** One Docker image (`ghcr.io/rev-oo/rpg-vtt-ai`) with one data volume holding a SQLite database and the installed plugins. It runs as a non-root user and has a healthcheck. A Caddy example puts it behind HTTPS. `docs/backup.md` covers backups.
- **Accounts.**
  - A setup screen creates the first admin.
  - Admins add users or send invite links, and can disable users.
  - Sign-in uses Argon2id passwords, rate limits, CSRF protection and a content security policy.
- **Tables.**
  - Any user can create a table on an installed system and becomes its GM.
  - Invites carry a role (player, spectator or assistant).
  - GMs manage members and set the system's house-rule settings.
- **Actors and items.**
  - Actors and items come in the types each system declares, with per-user ownership (none, observer or owner).
  - Items live in a table library and can be copied to actors.
  - Deleting is soft, with a restore window of 30 days by default (`SOFT_DELETE_RETENTION_DAYS`).
- **Live sheets.**
  - Sheets are Yjs documents edited together in real time.
  - They show who is editing each field.
  - Counters take server-applied steps.
  - Collaborative long text and rich text.
  - GM-only secret fields never reach other players.
  - Values are repaired on save, and sheets work at phone width.
- **Chat and rolls.**
  - Public messages, whispers and GM-only messages, filtered on the server.
  - `/r` and `/gmr` dice commands.
  - Rolls are made only on the server with a secure RNG.
  - Systems supply roll recipes with outcomes, and chat cards to show them.
- **Dice and formulas.**
  - A safe formula language with keep/drop, exploding dice, rerolls, success counting and custom dice such as Fate dice.
  - `@` references to sheet data.
- **Journal.** Collaborative rich-text entries with ownership. New entries start hidden, and the GM reveals them.
- **Plugins.**
  - A declarative JSON format for game systems: data schemas, sheet layouts, derived values, rolls, dice, cards, settings, translations and scoped CSS, plus optional client code for custom sheet nodes.
  - An admin page installs `.vttplugin` archives, enables and disables plugins, rescans and shows validation errors.
  - The `vtt-plugin` CLI validates, previews and packs plugins.
  - Two reference systems: `tiny-d20` and `tiny-pool`.
- **Documentation.** `docs/plugin-authoring.md` (with a tested tutorial) and the generated `docs/plugin-reference.md`.
- **Translations.** The interface comes in English and Brazilian Portuguese.

### Known limitations

- Plugin `code/shared` and `code/server` entries are packed but not run, so `handler` roll recipes fail and formulas can call only built-in functions.
- Combat, compendium packs, maps and plugin data migrations are not available yet.
- The `vtt-plugin` CLI and the plugin SDK are not published to npm; build them from this repository.
- The image is built for `linux/amd64` only.

[Unreleased]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rev-oo/rpg-vtt-ai/releases/tag/v0.1.0
