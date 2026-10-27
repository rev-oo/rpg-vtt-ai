# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). While the version is 0.x, minor versions may break plugins and stored data.

## [Unreleased]

### Added

- **Plugin shared and server code.** `code/shared` adds formula functions to sheets and rolls, and `code/server` runs `handler` roll recipes, which roll, post to the chat, read actors and adjust counters as the roller. Each plugin's code runs in a worker thread of its own with time limits, so a failing or looping plugin fails only its roll. The admin plugin page lists each plugin's code files.
- **Plugin slash commands.** `code/server` can declare chat commands, typed as `/name text` and posted to the chosen audience; `tiny-d20` adds `/check str` and `/check dex`. Commands and handlers can tell players what went wrong with `ctx.fail`.
- **Combat tracker.** GMs and assistants run an encounter beside the chat: add actors or free-form combatants, set initiative, begin, and pass turns through the rounds. Every member follows along live; hidden combatants, and whose turn it is while one acts, stay with the GM.
- **Initiative.** Systems with a `combat.json` roll initiative for every combatant from the tracker, into the chat, and order turns highest first, lowest first, or side by side. `tiny-d20` and `tiny-pool` roll initiative. Server code can order the turns with an `orderCombatants` hook and act at each turn's start with `onTurnStart`.

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

[Unreleased]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rev-oo/rpg-vtt-ai/releases/tag/v0.1.0
