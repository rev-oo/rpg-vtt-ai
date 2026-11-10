# ADR-081: Labels for values, and translated plugin texts

- **Status:** Accepted
- **Date:** 2026-11-10
- **Tasks:** T-1611
- **Covers:** FR-PLUGIN-05, FR-PLUGIN-16, FR-CHAT-06
- **Builds on:** ADR-025 (cards), ADR-047 (server code), ADR-075 (plugin settings by scope)

## Context

The 5e study (`docs/studies/srd5.md`, F11) and the dice-3d study (`docs/studies/dice-3d.md`, F5) found three places where a plugin could not be translated:

- **Choices.** A select showed `translate(value)`, so a value was translated only if it was itself a lang key. srd5 stored keys such as `class.wizard` and compared them in formulas. Damage types stayed plain words (`slashing`), shown in English in every language. dice-3d's colour setting did the same (`crimson`).
- **Card rows.** A row showed its value as resolved, so `@item.damageType` stayed English. srd5 had a `saveText()` shared function to write "Dexterity DC 13" in English.
- **Server code.** Handlers post plain text, so srd5's rest and death save messages were English.

The study also asked for a colour setting and for typed settings in plugin code.

## Decision

1. **`enumLabels` labels `enum` values.**
   - A type field or a `string` setting may map each `enum` value to a lang key or text: `"enumLabels": { "slashing": "damage.slashing" }`.
   - Selects show the label, translated, and store the plain value. A value without a label shows as before: translated if it is a lang key, else as it is.
   - The validator checks that labels go with an `enum`, name only its values (numbers by their text, `"6"`), and have an English text.
2. **Card rows translate values that are lang keys.** The core card translates a row's resolved value as it does its label, so a formula can build a key: `'damage.' + @item.damageType`. Text that is not a key shows as it is. Card values are not split or searched for keys inside a longer text.
3. **Server code posts by lang key.**
   - `ctx.chat.post({ key, params })` posts a key of the plugin's lang files, instead of `text`.
   - The message keeps `translation: { plugin, key, params }`. Its `text` is the English, with the parameters filled in, for whatever reads stored text: exports, notifications, a table whose system is no longer that plugin.
   - The web shows the viewer's language while the table's system is that plugin. `{name}` in the text is the `name` parameter; a string parameter that is a lang key (`ability.dex`) is translated too.
   - A key needs an English text, and a post has text or a key, not both; the handler fails otherwise.
   - An author who edits the message replaces the translation with their words.
   - `langText` in `@vtt/plugin-engine` fills a text in for both the server and the web. `fakeHandler().texts(locale)` reads posts as a viewer would, in plugin tests.
4. **A `colour` format for `string` settings.** The value is `#rrggbb`, picked with the browser's colour input. It cannot have an `enum`, and its default must be a colour.
5. **Typed settings come from `vtt-plugin types`.**
   - The command writes `code/src/settings.ts` from `settings.json`: a `Settings` interface, with each choice as a union of its values, and `readSettings(values)`.
   - `readSettings` takes what `useModuleSettings` gives and returns typed values, falling back to each default, with no casts.
   - A generated file, not an SDK generic: TypeScript reads JSON imports with wide types (`string`, not `'boolean'`), so a generic cannot get the setting types from `settings.json`.

## Consequences

- srd5 labels its damage types (`damage.*`), splits each damage row into dice and a type row, and splits the spell save into the ability (a key) and the DC. `saveText()` and the English ability names in `code/src/tables.ts` are gone. Its handlers post by key, and it ships `lang/pt-BR.json`.
- dice-3d labels its colours, reads its settings through the generated module, and its pt-BR file names the colours.
- `chat_messages` gains a `translation` column (migration 0019).
- `ctx.fail` messages are still plain text. A failure a `then` handler posts stays in the language the author wrote.
- Values inside a longer card text, and plugin texts outside chat (logs, item names in packs), are not translated.
