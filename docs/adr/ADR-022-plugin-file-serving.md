# ADR-022: Plugin file serving

- **Status:** Accepted
- **Date:** 2026-10-21
- **Tasks:** T-0405
- **Amends:** §4.2 (who may fetch plugin files, and which files)

## Context

§4.2 serves plugin assets under `/plugins/<pluginId>/*`. T-0405 asks for correct MIME types, cache headers and path traversal protection. It does not say who may fetch them, which files count as assets, or how scoped CSS (ADR-021) is delivered.

## Decision

1. **Who.** Any signed-in user may fetch the files (401 otherwise), and only while the plugin is available (enabled and `ready`, ADR-020). A disabled plugin's code is therefore never served; its files answer 404.
2. **Which files.**
   - Only regular files inside the plugin folder are served, and only these types: `js`, `mjs`, `css`, `json`, `map`, `txt`, `png`, `jpg`/`jpeg`, `gif`, `webp`, `avif`, `svg`, `ico`, `woff`, `woff2`, `ttf`, `otf`.
   - Everything else answers 404, so TypeScript sources and HTML are never served.
   - Hidden files and `.`/`..` segments answer 404, and so do backslashes and NUL.
   - Paths are resolved with `realpath`, so a symbolic link that leads out of the folder answers 404.
3. **Stylesheets.** `styles/*.css` are served scoped, from the disk cache (ADR-021). Other `.css` files answer 404, so unscoped CSS never reaches the page.
4. **Headers.**
   - `Cache-Control: no-cache` with an ETag, and `304` on `If-None-Match`: plugin files change on rescan without a new URL.
   - `X-Content-Type-Options: nosniff` on every file.
   - SVGs get `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.
5. **Dev proxy.** The Vite dev and preview servers proxy `/plugins` to the API, like `/api`.

## Consequences

- No new dependency: the handler streams files itself.
- Long-lived caching can come later with versioned URLs, such as `/plugins/<id>@<version>/…`.
