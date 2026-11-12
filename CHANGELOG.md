# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). While the version is 0.x, minor versions may break plugins and stored data.

## [Unreleased]

### Added

- The table page can be used from the keyboard (T-1620). F6 and Shift+F6 move to the next or previous panel group, landing in the chat's message box; **Skip to panel**, the page's first stop, goes straight to any open panel; the panels sit in a `main` landmark, and their tabs show the focus ring. The new [user guide](docs/user-guide.md) lists the keys.

- An address the app does not know shows **Page not found** with the way back, instead of the tables list (T-1620).

- Admins manage the instance's users on a new **Users** page (T-1619). They create a user, who signs in with a one-time password shown once and then chooses their own; reset a password to a new one-time password; disable or re-enable a user, which signs them out; make a user admin or not; and delete a user. Admins change their own account on the Account page, so there is always an enabled admin.

- Tokens show their actor's statuses, such as conditions (T-1618). A system lists true/false fields as statuses, each with an icon; while one is on, its icon shows on the token on the map, and the token list and combat tracker name it. A secret field's status shows only to the GM and assistants, and statuses follow the sheet as it changes. In `srd5`, the 14 conditions show on tokens, with icons of their own.

- Plugins can be translated end to end (T-1611). A field or setting's choices show labels in the viewer's language (`enumLabels`) while the stored values stay as they are; chat card rows translate values that are lang keys; and plugin server code can post messages by lang key, so each member reads them in their own language. Settings can be colours, picked with a colour picker, and `vtt-plugin types` gives plugin code its settings typed. The `srd5` system is now in Portuguese (Brazil) too, and `dice-3d` names its colours in both languages.

- Plugins can credit their content: a manifest `attribution` (text and a link) shows on the Plugins page and with each of the plugin's entries in the Compendium. The `srd5` system shows the SRD 5.2's credit there. Compendium packs may give collections as rows keyed by id, as stored data has them, as well as lists (T-1614).

- Plugin authors can test their code without a table (T-1613). `@vtt/sdk/testing` runs server handlers against a fake `ctx` that records what they did, and can roll the plugin's own formulas; `@vtt/sdk/client/testing` renders a module's overlays and panels in a test frame that sends them table events and records their actions. The guide's **Testing your code** section shows both.

- Modules declare their overlays and panels in `plugin.json` under `frames`, so a table page no longer runs a module's code an extra time to find them. Overlays and panels get the table system's custom dice (`useSystemDice()`), and `dice-3d` throws them when a die shape has as many faces: Fate dice land as d6s with their own faces. `vtt-plugin pack` prints the size of each code bundle and warns about one over 1 MiB, and the guide explains how plugin code uses npm packages (T-1612).

- Plugin server code works with items (T-1610): handler recipes can be made with an item, handlers get the actor's derived values, item totals and items, step item counters (`ctx.items.adjust`) and set plain fields (`ctx.actors.set`), and a roll's `then` runs server code after the roll is posted. Counters can be bounded by formulas such as `@hp.max`. The D&D 5e SRD system spends a spell slot when a spell is cast, recharges features on a Long Rest, and stops healing at the maximum.
- Tables can hold scenes, the maps of M14. GMs and assistants create them through the API with a background image (a web address or one of the table's images), a size in square or hex grid cells and a cell size; they edit, order and delete them, and choose the one scene players see. Players and spectators get only that scene, and members hear of each change at once. A scene's background is an image in use, so it cannot be deleted. Drawing scenes in the table arrives with the map canvas (FR-MAP-01, ADR-066).
- A Map panel in the middle of the table draws the scene players see: its background and its square or hex grid. Drag, pinch or scroll to pan and zoom; arrow keys pan, plus and minus zoom and 0 shows the whole scene, and buttons zoom on touch screens. GMs and assistants manage scenes in a new Scenes panel (make, edit with a background from the table's images, order, delete, show to players) and can look at any scene in the Map panel as a preview before players see it. A background from another site is drawn only if that site allows it; otherwise the map says to upload the image. Maps need a browser with WebGL (FR-MAP-01, FR-MAP-02, ADR-067).
- A scene's grid can be square, hex, hidden (no lines drawn, tokens still snap to cells) or none (tokens stand anywhere on the map, background included). The map can be dragged past the scene's edges, up to the far side of the panel (ADR-067, ADR-068).
- Tokens stand on a scene's cells: an actor's token shows its name and image, or a token stands alone with its own. GMs and assistants place them with Add token or by dragging an actor from Actors onto the map, hide and reveal them, and remove them; players move their own actors' tokens by dragging them on the map, or with the arrow keys on the map or in the token list under it once a token is selected (with none selected, arrows pan the map; clicking the map or the selected token in the list lets go of it), and everyone at the table sees moves at once. Hidden tokens, and their moves, never reach players. A token's actor opens from the list or by double-clicking the token (FR-MAP-03, ADR-068).
- Right-click a token on the map for its menu (open, hide or reveal, remove, as you may), or press Shift+F10 with a token selected (ADR-069).
- Fog of war: turn it on in a scene's form and players see only the areas you reveal, and the tokens in them; their own characters' tokens always show to them. GMs and assistants get Reveal and Hide on the map toolbar: drag from one cell to another (or click a cell) to reveal or hide them, or Reveal all and Hide all. GMs see the fog as a tint. Tokens in the fog, and their moves, never reach players; the background image itself is not cut, so a player who opens its address sees all of it (FR-MAP-04, ADR-070).
- A toolbar over the map switches to a Ruler: drag on the map, or click point after point for a path, to measure in the scene's unit (Enter or a double click ends a path, Backspace removes its last point, Escape clears it), or to a Circle or a Cone: drag from the centre or origin to read its radius or length (cones are as wide at their end as they are long). GMs set what a cell measures (5 ft by default), the unit and how diagonals count (one cell each, alternating 1 and 2, or a straight line) in the scene form. Only you see your measures (FR-MAP-05, ADR-069).
- Module plugins: plugins of `kind: module` extend any table, whatever its system. Admins enable them on the Plugins page, and GMs add them to a table under **Modules** in its Settings panel. A module may hold settings, translations, styles and client code but no types, sheets, rolls or packs, which the validator refuses. (FR-PLUGIN-16, ADR-075).
- Modules can change the table page's look. A module's `theme.json` sets the app's colours for the light and dark schemes (including the colour behind panels), its font, corners, border width, spacing density, font files, and images inside panels and behind the page for each scheme, and its stylesheets style named parts of the page, such as the chat, dock tabs, map tools and sheets. Both apply only on tables that use the module. The new `parchment-skin` module is an example (ADR-076).
- Modules can draw overlays over the table page and add panels to the workspace, opened from the Panels menu. Their code runs in sandboxed frames. It hears the chat messages and rolls you see, and combat, scene and token changes, and reads its settings for you. It can act as you: chat, roll, open sheets and journal entries, and take the combat actions you may take. The server checks every action as yours, and a frame can act at most 10 times in 10 seconds. **Overlays** in the table header turns a table's overlays off for you (FR-PLUGIN-16, ADR-077).
- The new `dice-3d` module throws 3D dice over the table for each roll you see (d4, d6, d8, d10, d12, d20, and d100 as two d10s) and lands them on the results the server rolled; the chat shows the result at once. Each member picks the dice colour, how long they stay and whether to see other people's rolls; admins set the most dice in one throw. **Overlays** in the table header hides them.
- The new `srd5` system plays the fifth edition rules of the System Reference Document 5.2 (CC-BY-4.0): characters with a class, abilities, saving throws, skills with Expertise, Armor Class from armour and shields, attacks with weapons, spells with slots from the class tables, conditions and Exhaustion, death saves, Hit Dice and Long Rests; creatures with stat blocks and actions; and an SRD pack of weapons, armour, gear, spells and creatures. It is in English. It is a study of the plugin format (`docs/studies/srd5.md`), so some things are done by hand: Advantage is chosen on the sheet before rolling, casting does not spend the slot, and damage is not applied to targets.
- Plugin settings can have a scope: `table` (the default, set by the GM), `instance` (set by admins for every table, on the Plugins page) or `user` (each member's own, under **My settings** in the table's Settings panel, kept for every table). The Settings panel now opens for every member; players and spectators see only their own settings. Formulas still read table settings only (ADR-075).
- Plugins can ship data migrations: `migrations/<version>.json` files with rename, move, set-default and drop steps, and a `migrate` hook in server code for the rest. Upgrading a table in its settings now migrates its actors and items, so their sheets stop showing the older-version notice; any whose data cannot be migrated keep it as it was, the settings list them with the reason, and **Migrate again** retries them (FR-PLUGIN-12, ADR-072).
- Formulas can take a die's size from data, `(@item.dice)d(@item.die)`, and roll dice kept in a text field, `roll(@item.extraDamage)`; `roll(text, 2)` doubles the dice for a critical hit. A text field with `"format": "dice"` holds such dice, and the sheet and the server refuse anything else. New `text(x)` and `signed(x)` write numbers as text, and `+` joins text with a number. The `srd5` system uses them: weapons and creature actions get an **Extra damage** field, and its formulas lose their chains of die sizes (T-1607).
- Roll recipes can name values (`let`) that their formulas, outcomes and card share, roll several named formulas into one chat message (an attack and its damage), and read the natural d20 (`@roll.natural`) and the dice that counted (`@roll.dice`). `actors` limits a recipe to some actor types: the validator checks it against those only, and the server refuses it for others. Formulas in a row of an `items` list read the row's item, so a row can show a button only for some items (T-1608).
- In `srd5`, one Attack button rolls the attack and its damage into one card, and a critical hit doubles the damage dice. Characters have a **Critical hit on** field for features such as Improved Critical. **Two hands** shows only for versatile weapons, and spells show **Cast** and **Effect** only when they have something to roll (T-1608).
- Roll recipes can declare options the player chooses when rolling: a choice such as Advantage, a whole number such as a spell slot level, or bonus dice such as Bless's `1d4`. The roll button asks for them in a dialog; holding Shift or Ctrl picks a choice and rolls at once. Recipes read them as `@options.<name>`, and the server checks them (T-1609).
- In `srd5`, every d20 roll asks for Advantage or Disadvantage and bonus dice (Shift rolls with Advantage, Ctrl with Disadvantage), which replaces the **Next d20 rolls** field. Spells are cast with a chosen slot level, and spells gain **Extra dice per slot level** and **Extra bonus per slot level** fields, filled in for the pack's spells (T-1609).
- **Ask for roll options**, on your own row of a table's member list, is on by default. Turned off, roll buttons at that table roll with a click, with every option at its default; Alt-click opens the options, and Shift and Ctrl still roll with Advantage or Disadvantage. Each member chooses for each table (T-1616).
- Chat cards can offer buttons that act on the token you have selected on the map (T-1617). In `srd5`, attack cards offer **Roll damage** to whoever may roll for the attacker, doubled on a critical hit and left off on a natural 1; the damage card then offers **Apply damage** and **Apply half damage**, and spell cards offer them for damage or **Apply healing** for healing: select a token whose actor you may edit, and its hit points change. A spell that asks for a saving throw offers **Roll saving throw**, which rolls the selected token's save against the spell's DC and shows Success or Failure. Plugin authors declare these `actions` in their cards; a roll action with `"for": "roller"` rolls for the card's actor, with the card's item.

### Changed

- The interface fixes of the review (T-1620):
  - Sheet fields in a row keep the width their input needs, and a grid with counters gets wider columns, in every system.
  - A roll in chat reads as rolled (`1d20 + 4`, the dice, the total); the recipe's formula with its `@` references shows under **Formula**.
  - On the map, token names sit on a pill readable in both themes, and status icons get a ring; both keep their size on the map at every zoom; the grid takes the theme's colour, over a casing that keeps it visible on light and dark maps.
  - Journal, combat and member rows wrap long names instead of cutting them; lists and filters show types by their label; the tracker shows initiative once, as a field for whoever runs combat; **Give** and **Copy** wait for an actor to be chosen.
  - The invite page names the table and its GM, to anyone holding a usable link, signed in or not; **Sign in** is a button.
  - **End encounter** sits apart from the turn buttons and asks first; **Add combatant** opens the form.
  - The default layout puts Chat, Dice and Combat in one group on the right, Chat in front; **Reset layout** brings it to tables already laid out.
  - Compendium entries open as a read-only sheet in a panel of their own, in place of the inline preview; the pack's credit shows there. `GET /tables/:id/compendium/entries/:ref` returns one entry and its pack.
  - On a read-only sheet, every field dims as its selects do (text and number fields, text boxes and checkboxes included), so it is clear none of them can be changed.
  - **Open** and **Open sheet** in the actor, item, journal and compendium lists, and on an actor's items, are buttons with an icon instead of links.
  - Actor and item sheets have **Rename**, as journal entries do, for whoever may edit them; the lists and the panel's tab follow the new name.
  - The plugins page says "1 error, 1 warning", and on a narrow card **Enable** follows the badges. Each form has one filled button; table Settings offers **Save modules** only when there are modules. Card actions, **History** and **Choose image** look like the other panel buttons.
  - Table cards, the table header and the Table panel name the system without its version, which stays on Settings and Plugins.

- A module's overlay is made interactive, and a panel given its title, in `plugin.json` under `frames`, no longer in `defineClient`. A module whose `plugin.json` does not declare its overlays and panels no longer shows them (T-1612, ADR-079).
- The formula shown next to a roll in the chat keeps only the branches the formula took, the dice a `roll()` rolled, and no `+ 0`: a longsword's damage reads `1d10 + 3` instead of every die size it might have used (T-1607).
- The app has icons. Dock tabs and the Panels menu show each panel's icon; the map's tools and zoom buttons, and the row actions in the Actors, Items, Journal and Scenes lists, are icon buttons with a tooltip and the same names for screen readers; New, Add token, Send, Roll, Upload and other common actions show an icon beside their text (ADR-071).
- The map's tools run down its left edge instead of across the top.
- Dragging with the middle mouse button pans the map whatever tool is picked, so the ruler, circle, cone and fog tools no longer need a switch back to Select to move the map (ADR-069).

### Fixed

- Roll buttons in a sheet row keep their width instead of covering the controls beside the row (T-1620).
- Scrollbars inside the table's panels follow the dark scheme, as the rest of the page's do (T-1620).

- A plugin's custom sheet parts and chat cards no longer show "failed to show" after their tab is hidden behind another one and shown again, or after their panel is moved. The app now starts the plugin's frame again (ADR-074).
- The Panels menu is no longer covered by the workspace's resize bars.

### Security

- Plugin shared and server code now runs in a separate JavaScript engine (QuickJS, in WebAssembly) inside its worker, so it can no longer reach Node: no files, environment, network, processes or imports, only the language, `console` and `ctx`. It may use 32 MB of memory. Packed plugins run unchanged, but code is interpreted, so heavy computation is slower (FR-PLUGIN-13, ADR-073).
- Plugin client code now runs sandboxed: each custom sheet node and chat card renders in a frame of its own, with no access to the page around it, the viewer's cookies or storage, or the network, and reaches the sheet only through the SDK hooks. In the browser, shared code runs in QuickJS too, as on the server. Packed plugins run unchanged; a component's images and fonts can only come from `data:` URLs (FR-PLUGIN-13, ADR-074).

## [0.4.0] - 2026-10-29

Tables get their own images: upload them, browse them in an Images panel, and use them for actor and item pictures, in journal text and in a sheet's image fields. Plugins written for 0.1.0 to 0.3.0 work unchanged: the plugin core API stays at `0.1.0`.

### Added

- An Images panel holds a table's images. Everyone at the table sees them; GMs and assistants upload by picking or dropping files and delete images nothing uses, while an image still used is kept and the panel says where it is used. A new image picker sets actor and item images from these images or a web address, on the create dialog and by a sheet's title, and the journal editor's Image button puts pictures in an entry's text. A sheet's image fields, such as tiny-d20's portrait, open the same picker when clicked; until now nothing could fill them (FR-ASSET-02, ADR-065).
- Images can be uploaded to a table. GMs and assistants send PNG, JPEG, GIF or WebP images, which are checked by their contents (SVG and anything else is refused), and every member of the table can view them. Admins set the largest upload and the space all uploads may take on the instance settings page. Backups and their restore include the uploaded images. Picking them from the app arrives with the asset manager (FR-ASSET-01, FR-ASSET-03, ADR-064).

### Known limitations

- Plugin data is not migrated between system versions: sheets made with an older version show a notice, and fields the new version changed read as their defaults.
- Maps and tokens are not available yet.
- The `vtt-plugin` CLI and the plugin SDK are not published to npm; build them from this repository.

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

[Unreleased]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rev-oo/rpg-vtt-ai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rev-oo/rpg-vtt-ai/releases/tag/v0.1.0
