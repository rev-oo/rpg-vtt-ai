# ADR-024: Sheet renderer

- **Status:** Accepted
- **Date:** 2026-10-21
- **Tasks:** T-0408
- **Amends:** §8.5 and §8.6 (details below)

## Context

T-0408 turns sheet layouts (§8.5) into React. The live documents (M5), plugin code (T-0409) and the plugin CLI (T-0410) come later, so the renderer must work against an interface now. §8.5 does not say how inputs validate, how nodes hook into plugin CSS, or how sheets fit phones.

## Decision

1. **`SheetStore`.**
   - The store holds the data as a snapshot that is replaced on every change (`getSnapshot`, `subscribe`), so `<Sheet>` reads it with `useSyncExternalStore`.
   - Writes are `set`, `adjust` (counters, FR-SHEET-08), `addRow`, `removeRow` and `moveRow(path, id, before)`.
   - Paths are key arrays, and inside a collection the row id is a key (ADR-023).
   - `createMemoryStore()` backs previews and tests; the live store (M5) implements the same interface over Yjs. It gives rows `sortKeyBetween()` keys, so a move changes one row.
2. **`<Sheet>`.**
   - It takes the layout, the type (schema and derived values), the store, the setting values, shared functions, `readOnly`, `secret`, a `translate` function for plugin texts, the renderer's own `strings` (English defaults; the app passes its catalogue), `onRoll` and custom nodes.
   - Missing data reads as the schema's defaults. Derived values are recomputed on every change and never stored (FR-SHEET-05).
3. **Formulas in the sheet.**
   - `visibleIf` and roll arguments read the data, `@derived`, `@settings` and, in a list, `@row` (with `id`).
   - A `visibleIf` that fails, or is not `true`, hides its node.
   - A roll button whose arguments fail is disabled, with the error as its title.
4. **Inputs.**
   - Without `input`, a field picks one from its schema: `enum` → select, `x-counter` → counter, boolean → checkbox, number → number, else text.
   - Number and text inputs check type, integer, `minimum`, `maximum` and `maxLength` as the user types. They store only valid values and show the problem otherwise (FR-SHEET-09). Leaving the input shows the stored value again.
   - A counter's first step starts from its default.
   - `longText` is a plain text area until collaborative editing arrives (FR-SHEET-07, M5).
   - Images load only `http(s)`, rooted and `data:image` URLs.
5. **Secret fields.** A node bound to a secret field, or to a field inside one, renders nothing unless `secret` is set. The server still never sends the field to players (FR-SHEET-04).
6. **Read-only.** `readOnly` turns inputs read-only, disables checkboxes, selects and counters, and hides list controls. The root gets `data-readonly` (FR-SHEET-03). Roll buttons change no data, so they follow `onRoll` alone: the host passes it to whoever may roll (amended by ADR-025).
7. **Hooks for plugin CSS.**
   - The root carries `data-plugin` (ADR-021).
   - Each node gets the class `vtt-<type>` plus its own `class`. Bound nodes get `data-field="<path as written>"` (§8.6), list rows `data-row`, derived values `data-derived` and roll buttons `data-roll`.
   - Spacing and the accent colour use the tokens `--vtt-gap-sm|md|lg` and `--vtt-accent`, defined on `:root` in `@vtt/ui/theme.css`. A plugin's `:root` rule lands on its sheet root, so its tokens win by inheritance, whatever the layer order.
8. **Phones (FR-SHEET-10).**
   - The root is a size container, and rows stack below the `@md` container width.
   - A grid shows at most `columns` columns, but no column narrower than 7rem.
   - Checked in Chromium at 360 px: no horizontal scroll.
9. **Custom nodes.** `custom:<name>` renders the component passed in `nodes` with `{ props, rowPath }`; `useSheet()` exposes the sheet to it. A missing component shows a notice in place of the node.
10. **Preview.** `pnpm --filter @vtt/sheet-renderer preview` is a Vite page that loads every folder in `plugins/` through `import.meta.glob`. It validates the plugin, injects its scoped CSS, and renders each type's sheet against a memory store. It offers read-only and GM views, and rolls run with the plugin engine. It has its own tsconfig with Vite's types, and its test renders `tiny-d20`.

## Consequences

- The web app adds `@source '…/packages/sheet-renderer/src'` to its Tailwind entry when it mounts sheets (T-0409).
- Presence outlines (FR-SHEET-02) and the collaborative text editor are added with the live store in M5.
