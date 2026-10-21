# ADR-023: Plugin engine

- **Status:** Accepted
- **Date:** 2026-10-21
- **Tasks:** T-0407
- **Amends:** §8.4, §8.7, §8.8, §8.11, §9.2 and §9.4 (details below)

## Context

T-0407 builds `packages/plugin-engine`, the pure package that applies a validated plugin (ADR-019): defaults, derived values, roll recipes, cards, and the shape of an actor's live documents. The spec leaves open how collections look outside Yjs, what a failing formula does, and how a card is chosen when its template is gone.

## Decision

1. **Pure, and types only from `plugin-schema`.** The engine imports only types from `@vtt/plugin-schema`, so the web bundle never pulls in the CSS scoper (ADR-021). Randomness comes in as an `Rng`, and plugin `shared` functions come in as options.
2. **Collections.** Outside Yjs a collection is an object keyed by row id, the same shape as its `Y.Map` (§9.4).
   - Each row holds its fields and a `sort` key. The id is the key, never a field, and `collectionRows()` adds it back in `sort` order.
   - Formulas read rows by id (`@skills[@args.id].rank`) and aggregate them with `[*]`.
   - Sort keys are base-36 fractions compared as strings (`i`, `r`, `w`…). `sortKeyBetween(before, after)` gives a key between two neighbours, so moving a row changes only its own key.
   - Default rows (a collection's `default` array) get the ids `d0`, `d1`… and keys from `sortKeys()`.
3. **Defaults.** A field without `default` starts empty: `''`, `0`, `false`, `[]`, `{}` for a collection, and an object built from its properties.
   - `withDefaults()` fills in only what stored data leaves out, at every depth and in every row.
   - Values of the wrong shape are left alone; repairing them is the store's job (§9.7).
4. **Derived values.**
   - They are computed in pure mode, each after the derived values it reads, whatever order the file lists them in.
   - They read the entity's data with defaults filled in, plus `@settings`.
   - A value that fails is reported in `errors` (its `FormulaError` code), and so is each value that reads it (`depends_on_failed`). The others are still computed.
   - A cycle, which the validator already rejects, fails its members (`cycle`) instead of looping.
5. **Settings.** A stored value is used when it fits its setting (type, range, `enum`, `maxLength`); otherwise the default is.
6. **Custom dice.** A text face counts as its entry in `values`, or as the number it spells (`"3"`), or 0. Number faces count as themselves.
7. **Recipes.**
   - A recipe's formula reads the actor's data, `@derived`, `@settings` and `@args`.
   - Outcomes and card rows also read `@total` and `@roll.expression`, `@roll.resolved` and `@roll.total`.
   - Outcomes are checked in order, and the first that matches wins. An outcome without `when` always matches.
   - A `when` that fails, or that is not true or false, does not match and is listed in `problems`; it never loses the roll.
   - A formula that cannot be rolled throws `FormulaError`.
   - `handler` recipes throw `EngineError('handler_recipe')`, since they run plugin code (§8.10).
8. **Cards.**
   - A recipe's card is resolved when it is rolled, with the data of that moment. The result holds its title, rows and outcome flag.
   - A row whose formula fails keeps its label and carries the error.
   - A card the plugin lacks is listed in `problems` (`missing_card`).
   - `chatCardView()` shows the card while its template exists (a card file or a custom component). Otherwise it falls back to plain text, such as `Skill: 1d20 + 2 + 2 = 16 (Success)` (FR-CHAT-06). Texts are translated through a function the caller passes; without one they stay lang keys.
9. **Document layout.** `documentLayout(schema)` describes the `data` map of `actor:<id>:main` and, when any field is secret, of `actor:<id>:secret` (§9.1, 9.2). Each field is one of four kinds:
   - `value`: a plain JSON value, for scalars, images and plain arrays;
   - `text`: a `Y.Text` (`longText`, `richText`);
   - `map`: a nested map;
   - `collection`: a map of rows keyed by id.

   A secret field moves to the secret document at the same path, with everything under it. Maps and collection rows that hold secret fields appear in both documents, and rows share their ids.

10. **Entry point.** `createRules(plugin, { settings, functions })` ties the pieces to one plugin and one table. It offers `defaults`, `derived`, `layout` and `roll`, and throws `EngineError('unknown_type' | 'unknown_recipe')`.

## Consequences

- The server's roll endpoint does not use the engine yet. It still rolls typed formulas against the raw `system` data (ADR-018), so recipes, derived values and custom dice are not available from chat until the server is wired up.
- Live documents (M5) build their `Y.Map`s from `documentLayout()`, and the renderer (T-0408) reads collections with `collectionRows()`.
