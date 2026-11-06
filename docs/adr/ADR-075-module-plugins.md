# ADR-075: Module plugins, and plugin settings by scope

- **Status:** Accepted
- **Date:** 2026-11-06
- **Tasks:** T-1601
- **Covers:** FR-PLUGIN-16, FR-ADMIN-04, §8.3, §8.12

## Context

Until now every plugin was a game system: a table is created with one, and it brings the table's types, sheets, rolls and packs. M16 adds modules: add-ons that extend any table, whatever its system, such as a skin for the table page or 3D dice on rolls. The skin and the dice are examples; modules are a generic way to extend a table. T-1602 adds themes and named parts and T-1603 adds frames (overlays, panels, events, actions). This decision covers what a module is, how it reaches a table, and the settings that come with it.

Plugins also need settings that are not house rules. A dice module wants an admin to cap effect quality for the whole server, a GM to choose whether secret rolls show dice, and each player to pick their dice colour. Until now `settings.json` held only table settings, which the GM sets and formulas read.

## Decision

1. **`kind: module`.** The manifest's `kind` is `system` or `module`. A module may have `plugin.json`, `settings.json`, `lang/`, `styles/` and `code/client.js`, and from T-1602 a theme. It may not have what a system defines: `types/`, `sheets/`, `cards/`, `packs/`, `migrations/`, `rolls.json`, `dice.json`, `combat.json`, `code/server.js` or `code/shared.js`. The validator reports each such file as `module_file`, an error. Modules have no server code for now.
2. **Enabling.** Admins enable modules on the Plugins page as they enable systems, acknowledging code when there is any. A scan records each plugin's kind; a plugin whose kind changes is disabled until an admin enables it again, since tables may use it as the other kind.
3. **Systems stay systems.** `GET /systems` and `GET /systems/:id` cover systems only, and a table can only be created with a system.
4. **Choosing modules.** A table keeps the modules its GM chose, by id (`game_tables.modules`), and their table settings (`game_tables.module_settings`). `PATCH /tables/:id` takes `modules`, each of which must be an enabled, ready module, and `moduleSettings`, by module id. Settings of a module the table drops are dropped too. A module that an admin later disables stays chosen but loads nowhere; the GM's list marks it so it can be removed. `GET /modules` lists the modules GMs may choose.
5. **Loading.** `GET /tables/:id/modules` gives a table's members its available modules: each definition (without packs or migrations), the URLs of its styles and client code, and every setting's value for that viewer. Others get 404, as for the table itself. The web app loads them with the table; T-1602 and T-1603 draw them.
6. **Settings by scope.** Each setting in `settings.json` may declare a `scope`, for systems and modules alike:
   - `table`, the default: the GM sets it in table settings. A system's are its house rules, stored on the table as before; a module's are stored in `module_settings`.
   - `instance`: admins set it on the Plugins page, for every table, whether or not the plugin is enabled (`plugins.settings`). Scans keep these values.
   - `user`: each member sets it for themselves in the table's Settings panel (`user_plugin_settings`, one row per user and plugin). It applies at every table that uses the plugin.

   Each scope has its own endpoints: `GET`/`PATCH /plugins/:id/settings` (admins), `GET`/`PATCH /me/plugins/:id/settings` (any signed-in user, for an available plugin), and the table's `settings` and `moduleSettings`. Each refuses names its scope does not declare and values that do not fit, as table settings did (FR-ADMIN-04). A setting takes its value from its own scope's store; a stored value that no longer fits reads as the default.

7. **Formulas read table settings only.** `@settings` holds a system's `table` settings. Instance and user settings would make derived values differ by viewer or by server, so the validator reports a formula that reads them as `unknown_reference`.
8. **The Settings panel opens for everyone.** Players and spectators see only **My settings**: their own settings of the table's system and modules. GMs and assistants also see the table, its house rules, its modules with their table settings, the system version and archiving.

## Consequences

- Existing plugins keep working: their manifests say `system`, and their settings are table settings.
- A module cannot change system data, rolls or the rules, so adding one to a table cannot break its sheets.
- User settings follow a player from table to table, so a dice colour is picked once. Players cannot set different values at different tables.
- Changing instance settings or a user's own does not notify open tables yet; T-1603 sends module frames their settings as they change.
- System instance and user settings are stored, but nothing reads them until frames get settings in T-1603.
