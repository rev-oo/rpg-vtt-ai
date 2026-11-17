# ADR-085: Players upload images and list only their own

- **Status:** Accepted
- **Date:** 2026-11-17
- **Covers:** FR-ASSET-01, FR-ASSET-02
- **Amends:** ADR-064 (who uploads), ADR-065 (who lists and deletes images)

## Context

Under ADR-064 and ADR-065, only GMs and assistants uploaded images, and every member saw every image of the table in the Images panel and the image picker. That has two problems:

- **Spoilers.** A GM who uploads next session's map or a villain's portrait ahead of time shows it to the players.
- **Players can't use their own pictures.** A player who wants a portrait for their character has to host it somewhere else and paste its address.

## Decision

1. **Players upload.** GMs, assistants and players of a table that is not archived upload images (`canUploadAssets`, `@vtt/shared`). Spectators edit nothing, so they upload nothing. The size limit and the instance quota apply as before.

2. **Players list only their own images.** `GET /tables/:id/assets` returns every image to GMs and assistants, and to others only the images they uploaded (`canManageAsset`). The Images panel and the image picker show that list. Images are not shared with players: a GM who wants a player to use one sets it on the player's actor, or gives them its address.

3. **Deleting follows the list.** GMs and assistants delete any unused image, and players delete their own. An image whose uploader's account is gone stays with the GMs and assistants.

4. **A player is not told what uses their image.** The `409 asset_in_use` refusal lists the uses only to GMs and assistants. Players get an empty `uses` list, so a hidden actor or journal entry that uses their picture does not give its name away.

5. **Serving does not change.** `GET /assets/:id` still serves an image to every member of its table. An image's address ends in a random id, so a player finds an image they were not listed only where it is already used and shown to them, such as the active scene or an actor or journal entry they can see. There it is no secret. Checking each image's uses on every load would cost more than it protects.

## Consequences

- A GM's images stay out of the players' panel and picker until the GM uses them somewhere players see.
- Players set their characters' portraits, and pictures in journal entries they own, from their own uploads.
- Players' uploads count against the one quota of the instance, as everyone's did. The security review's accepted risk #5 already covers one user filling it, since any user may create a table and upload to it.
- A GM cannot hand a player a library of images to pick from. If groups need that, a "shared with players" flag on an image can come later.
