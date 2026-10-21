# ADR-021: Scoped plugin CSS

- **Status:** Accepted
- **Date:** 2026-10-21
- **Tasks:** T-0404
- **Amends:** §5 (the CSS scoper lives in `plugin-schema`; the server keeps the disk cache), §8.6 (details below)

## Context

§8.6 lists what the loader does to plugin CSS, but not how each rule is read. Both the server and `vtt-plugin validate` (§8.13) must apply it, and the validator reports CSS problems (ADR-019).

## Decision

1. **Where.** `scopeCss(source, { pluginId, file })` and the PostCSS plugin behind it live in `@vtt/plugin-schema`, next to the validator, which runs them on `styles/*.css`. The server caches results on disk (`ScopedCssCache`). Each entry is keyed by a SHA-256 of the processor version (`CSS_SCOPE_VERSION`), the plugin id, the file path and the content.
2. **Scope.** The scope is `[data-plugin="<id>"]`.
   - Every selector is prefixed with it as an ancestor, including inside `@media`, `@supports` and `@container`.
   - A top-level `:root` becomes the scope itself, so `:root { --vtt-accent: … }` overrides tokens for the plugin's sheets only. A `:root` nested in `:is()`, `:not()` and the like is rewritten too, but the selector is still prefixed.
3. **Layer and containment.** All rules go inside `@layer plugin`. A `[data-plugin="<id>"] { contain: layout paint; }` rule follows outside the layer, so plugin rules cannot undo it.
4. **At-rules.** Only `@media`, `@supports`, `@container`, `@layer`, `@font-face` and `@keyframes` are kept. `@charset` is dropped silently; every other at-rule (`@import`, `@page`, `@property`, `@namespace` …) is removed with a warning.
   - Keyframe names get the prefix `<id>--`, and `animation` and `animation-name` values that use a keyframe from the same file are renamed to match.
5. **Forbidden.**
   - Selectors that name `html` or `body` are removed with a warning, which also covers `position: fixed` on them.
   - `z-index` is removed from top-level `:root` rules.
6. **URLs.**
   - Relative URLs resolve against the stylesheet's folder and become `/plugins/<id>/<path>` (served by T-0405).
   - A URL that is absolute, external (`https:`, `//`), rooted (`/…`) or leaves the plugin folder removes its whole declaration, with a warning. `data:` URLs are kept.
   - An `@font-face` left with no `src` is removed.
7. **Limits.** A stylesheet over 256 KB (counted in UTF-8 bytes) is an error, as is one that does not parse. Either way the file produces no CSS.
8. **Issues.** `css_stripped` (a warning, with the rule and its line), `css_too_large` and `css_invalid` (errors) use the validator's issue format.

## Consequences

- An animation that uses keyframes from another file of the same plugin is not renamed. Plugins keep keyframes next to the rules that use them.
- The scanner reads `styles/*.css` as text so the validator can check it.
