# ADR-026: Plugin CLI and plugin archives

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0410
- **Amends:** §4.3, §4.4, §5, §8.2, §8.13 and §10.1 (details below)

## Context

T-0410 adds `vtt-plugin` (§8.13): `validate`, `dev`, `pack` and `schema`. It is done when `pack` produces an archive the server can install, but the server only scanned folders in `DATA_DIR/plugins`, and §8.13 does not define the archive, how it is installed, or what `pack` compiles.

## Decision

1. **`@vtt/plugin-io`.**
   - A new Node package holds what the server and the CLI share on disk:
     - reading a plugin folder for the validator (moved from the server; links are skipped);
     - a ZIP writer and reader;
     - the archive layout.
   - It may import `shared`, `formula` and `plugin-schema`. The server and the CLI import it; the server may not import `plugin-cli`, which carries Vite and the bundler (§4.4).
2. **The `.vttplugin` archive.**
   - It is a ZIP of the plugin folder's files. `plugin.json` sits at the root, or inside one top-level folder, which is dropped, so a zipped folder works too. Dot files and `node_modules` are left out.
   - The writer uses deflate and UTF-8 names, with fixed timestamps: the same files give the same bytes.
   - The reader refuses anything it cannot unpack safely, with a stable `reason`:
     - absolute paths, `..`, backslashes, drive letters, or names repeated ignoring case (`unsafe_name`, `duplicate_name`);
     - symbolic links, encrypted entries, ZIP64, split archives, compression methods other than deflate;
     - a bad CRC or a damaged structure.
   - **Limits:**
     - 2000 entries;
     - 20 MB per file and 50 MB in all, unpacked;
     - 20 MB for the uploaded archive.
   - The limits are checked against the central directory before unpacking. Each file is inflated with a cap at its declared size, so an archive that lies about its sizes is refused.
3. **Installing (FR-PLUGIN-01).**
   - `POST /api/v1/plugins/install` (admin) takes the archive as an `application/zip` body. `?replace=true` lets it replace an installed plugin of the same id; without it, that is `409 plugin_exists`.
   - The plugin is validated as on a scan. An archive with errors is `422 invalid_plugin`, with the issues in `details`; one that cannot be unpacked is `422 invalid_archive`, with its `reason`.
   - The files unpack into `DATA_DIR/cache/install/<uuid>` and are then moved into `DATA_DIR/plugins/<id>`, so a scan never sees a half-written folder. The folder is named after the manifest id. Installs run in the registry's queue, one at a time with scans, and a rescan follows.
   - A new plugin starts disabled. A replaced plugin keeps its enabled state, except that one with code is disabled until an admin enables it again, since its code may have changed (FR-PLUGIN-06).
   - The plugin admin page has an **Install plugin** button. It asks before replacing, and it lists the issues of a refused plugin.
4. **`vtt-plugin validate <dir>`.** It reads and validates the folder as a scan does, but without the folder-name rule: an installed folder takes its name from the id. It prints errors on stderr and warnings on stdout, then a summary. It exits with 1 on errors and 2 on bad usage or a missing folder.
5. **`vtt-plugin pack <dir> [--out <file>]`.**
   - It refuses a plugin with errors.
   - The code entries are `code/client`, `code/server` and `code/shared` (§8.10), each `.ts`, `.tsx`, `.js` or `.jsx`. Each compiles with rolldown to one minified ES module, `code/<name>.js`, with JSX in the automatic runtime. `react`, `react-dom`, `@vtt/sdk` and `node:` modules stay imports (ADR-025); other imports are bundled. Other script files under `code/` are sources and are not shipped.
   - Stylesheets are minified with lightningcss before the server scopes them.
   - The packed files are validated again, as the server will see them. The archive is written to `<id>-<version>.vttplugin` by default.
   - **Deviation from §8.2:** no `.d.ts` files are emitted. Authors type their code against `@vtt/sdk`.
6. **`vtt-plugin dev <dir> [--port <n>]`.**
   - A Vite server renders the plugin's sheets with a memory store and the type defaults. It offers read-only and GM views, runs rolls with the plugin engine, and uses the plugin's custom nodes and cards.
   - The page lives in `packages/plugin-cli/dev/`. A virtual module carries the validated plugin with its scoped CSS. Client code loads from the plugin folder through Vite, and its `react` and `@vtt/sdk/client` imports resolve to the page's copies, as the app's import map does.
   - Changing any plugin file reloads the page; code changes go through Vite's module graph.
   - The node bridge to `@vtt/sdk/client` is a small copy of the web app's, since neither app code nor `sheet-renderer` can host it for both.
7. **`vtt-plugin schema [--out <dir>]`.** It prints the JSON Schemas of plugin files, or writes them, as `@vtt/plugin-schema` ships them.

## Consequences

- An admin installs a plugin without shell access to the data directory; copying a folder and rescanning still works.
- Archives come from admins, who are trusted, but are still unpacked defensively, since a bad archive could otherwise write outside `DATA_DIR`.
- The CLI depends on Vite, rolldown and lightningcss; the server does not.
