# ADR-076: Module themes and named parts of the table page

- **Status:** Accepted
- **Date:** 2026-11-06
- **Tasks:** T-1602
- **Covers:** FR-PLUGIN-16, §8.6
- **Builds on:** ADR-021 (scoped plugin CSS), ADR-075 (module plugins)

## Context

Modules (ADR-075) should be able to change how the table page looks, as a parchment or sci-fi skin would, without code. A system's stylesheets are scoped to its own sheets (ADR-021) and cannot reach the rest of the page. A skin needs two things: to change the app's design tokens (colours, fonts, corners) everywhere on the page, and to style particular parts of it, such as the chat or the dock tabs, through names that do not change when the app's markup does.

## Decision

1. **`theme.json`, for modules only.** It sets the app's colour tokens for the light scheme (`light`) and the dark scheme (`dark`), the text font (`font`), the corner radius (`radius`, with the smaller and larger corners scaled from it), fonts loaded from the module's files (`fonts`) and an image tiled behind the table page (`background`). Every value is checked against a narrow pattern: colours are hex, names or colour functions of plain numbers; font lists hold only names, commas and quotes; radii are lengths in `px`, `rem` or `em`; files are paths inside the module without `..`. None can end a declaration or load from elsewhere. The validator checks that fonts and the background are the module's own font and image files (`missing_file`, `theme_file`). A system with a `theme.json` is refused (`system_file`).
2. **The server builds the theme's CSS** from the checked theme and serves it as `/plugins/<id>/theme.css`, like other plugin files: for signed-in users, while the module is available. No plugin file can be at that path, since plugin CSS is served only from `styles/`.
3. **Scope: the page while the module is on.** The table page sets `data-vtt-modules` on `<html>` to the ids of its loaded modules, and links their stylesheets (the theme first). Theme and module rules match `:root[data-vtt-modules~="<id>"]`, so they apply only on that table's page, and both the attribute and the links go when the page closes or the GM removes the module. Being on `<html>`, tokens reach dialogs and menus too. Light colours sit in `@media not (prefers-color-scheme: dark)` and dark ones in `@media (prefers-color-scheme: dark)`, so a theme that sets only one scheme leaves the other as the app's.
4. **Named parts.** Parts of the table page carry `data-vtt-part`: `table`, `table-header`, `workspace`, `tab`, `panel`, `chat`, `chat-message`, `chat-composer`, `map`, `map-toolbar` and `sheet` (`VTT_PARTS` in plugin-schema). The names are an API: a name is never reused for another part and stays while the part exists. New parts may be added.
5. **Module stylesheets are scoped to parts.** The CSS scoper has a module mode: every selector gets the module's page scope in front, must name a part with `[data-vtt-part…]` or be `:root` alone (which sets tokens for the page), and sits in `@layer module`. A selector without a part is removed with a warning (`css_part_required`); a part name that does not exist is a warning (`css_unknown_part`). The rest of ADR-021 holds: no `@import`, no `html` or `body` selectors, no `z-index` on `:root`, and URLs only inside the module.
6. **The example.** `plugins/parchment-skin` sets a parchment palette for both schemes, a serif font, small corners and a paper background, and adds borders and small caps to the header, tabs, chat and sheets.

## Consequences

- A skin is a few JSON values and a stylesheet; it cannot run code or load anything from outside its own files.
- Two modules with themes on one table both apply; the later one in the table's list wins where they set the same token.
- The part names must stay stable from 1.0 (T-1701's freeze lists them). Styles that rely on the app's own classes or markup inside a part are not covered and may break.
- Module stylesheets reach the whole table page, including sheets, so a skin can clash with a system's sheet styles; the sheet's own styles sit in `@layer plugin`, which comes before `@layer module`.
