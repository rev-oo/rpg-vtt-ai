# ADR-083: Token statuses from actor fields

- **Status:** Accepted
- **Date:** 2026-11-11
- **Tasks:** T-1618
- **Covers:** FR-MAP-03, FR-COMBAT-04
- **Builds on:** ADR-068 (tokens), ADR-049 (combat), ADR-076 (theme files)

## Context

srd5 keeps its conditions as true/false fields on the sheet. Nothing showed them on the map or in the combat tracker, so a GM had to open each sheet to see who was prone or poisoned. The 5e study (`docs/studies/srd5.md`, F14 and P15) asked for statuses on tokens. Other systems have the same need with their own states, so the core cannot hard-code a list of conditions.

## Decision

1. **An actor type lists `statuses`, at most 32.** Each one has three keys:
   - `field`: a `boolean` field of the type, reached through objects only;
   - `label`: a lang key or text;
   - `icon`: an image file of the plugin. SVG is allowed, unlike theme files. Plugin files are served with a CSP that stops scripts, and the app only loads them as images, where scripts never run.

   The validator checks each status:
   - the field exists (`unknown_field`) and is a `boolean` (`field_mismatch`);
   - the icon exists (`missing_file`) and is an image (`icon_file`);
   - the label is translated.

2. **The server sends the statuses that are on.**
   - Token views and combatant views carry `statuses`: `{ field, label, icon }`, where `icon` is the file's URL under `/plugins/<system>/`.
   - The engine's `activeStatuses` reads them from the actor's data, in the order the type lists them.
   - A status whose field is secret, or inside a secret object, goes only to GMs and assistants.
   - The statuses come from the actor's projection, which joins both layers.
   - The table's system must be available, or the views carry none.
   - Players see the public statuses of every token and combatant they see, even when they cannot open its actor. A prone goblin is plain to see at the table.
3. **Statuses follow the sheet through the existing events.**
   - When collab stores an actor's document, it hands the data the projection held before to a callback.
   - If the actor's statuses differ from before, the server sends `token.updated` for each scene holding one of its tokens, to those who see such a token. It sends `combat.updated` too when the actor is in the encounter.
   - If only secret statuses changed, only GMs and assistants hear of it.
   - Clients refetch, as they already do for these events. A change shows after the store debounce (2 seconds by default), not keystroke by keystroke.
4. **The web shows them in three places.**
   - **The map:** up to five icons in a row along the top of the token. Past five, the last place shows how many more there are.
   - **The token list and the combat tracker:** the icons as images named by their translated label, which is also their tooltip. The token list is the map's accessible mirror, so screen readers hear the statuses too.

## Consequences

- srd5 lists its 14 conditions as statuses, for characters and creatures, with original icons: a white glyph on a dark disc, readable on the map and in both themes. Exhaustion is a number, so it is not a status.
- A status only shows a field. It does not change other actors' rolls; a condition affecting attacks against its actor waits for targets (T-1615).
- Every stored sheet costs one status comparison, against data already in memory. Nothing is sent unless a status changed.
- Icons are not drawn over each other: a token with many statuses shows a count instead of shrinking them.
