# ADR-068: Tokens are rows on a scene's cells, filtered per member and refetched on events

- **Status:** Accepted
- **Date:** 2026-10-30
- **Tasks:** T-1403
- **Covers:** FR-MAP-03, NFR-08 (hidden tokens)
- **Amends:** ADR-065 (a standing-alone token's image counts as an asset use)

## Context

T-1403 puts tokens on scenes (ADR-066). A token stands for an actor, taking its name and image, or stands alone. GMs place, hide and remove tokens, owners move their actors' tokens, and moves show live to everyone who may see them. Hidden tokens must never reach players, on REST or on the event stream. Like scenes and encounters, tokens are changed by one person at a time, so they need no shared document.

## Decision

1. **Rows.** `tokens(id, scene_id, actor_id?, name, image_url?, column, row, hidden)`. Deleting a scene or an actor deletes its tokens. A scene holds at most 500 tokens.
2. **Cells, not pixels.** A token stands on a grid cell (`column`, `row`) inside the scene, so moves snap to the grid by construction. A cell off the scene is refused (`422 token_off_scene`). Each token takes one cell; larger tokens would need another decision.
3. **An actor's token** shows the actor's current name and image, read at each request, and stores neither. A token standing alone has its own name and image (an http(s) URL or one of the table's images). Its image is an asset use, so the image cannot be deleted while the token shows it. While an actor is in the trash, its tokens are left out of every list.
4. **Who sees** (`canSeeToken`): GMs and assistants see every token of every scene. Players and spectators see the tokens of the active scene that are not hidden. Any other token is `404` to them, like any other scene, so its existence does not leak.
5. **Who moves** (`canMoveToken`): GMs and assistants move any token. A player moves the tokens of actors they own (`canEditActor`) while they can see them. Spectators and tokens standing alone are moved only by the GM. Only GMs and assistants hide, rename, re-image and remove tokens; owners get `403` for anything but a move.
6. **Endpoints.** `GET`/`POST /scenes/:id/tokens`, `PATCH`/`DELETE /tokens/:id`. Each answer carries `movable` for the caller, since a player cannot see the ownership of actors they do not own.
7. **Events.** Each change sends `token.updated {sceneId}` only to the members who could see the token before or after the change. A hidden token's moves therefore go to GMs and assistants alone, and revealing it reaches players. Clients refetch the scene's tokens, which the server filters. A scene becoming active is already told by `scene.updated`.
8. **On the map**, tokens are discs in a colour kept per token, with the image masked to a circle (or the name's initial) and the name below. Hidden tokens are drawn at half opacity for GMs. Members drag tokens they may move: the viewport stops panning while a token is held, and the token drops on the cell under it. A list under the map names each token and its cell (1-based). Its buttons select a token; arrow keys on one the member may move move it a cell at a time. Through the list, GMs hide, reveal and remove tokens, and any member opens the sheet of an actor they can see. A double click or tap on a token on the map opens it too. GMs place a token on the scene's middle cell with **Add token**.
9. **Moves are optimistic.** The token moves at once, and the server's answer replaces it; a refused move is reported and the list refetched.

## Consequences

- Hidden tokens and their moves never leave the server for players: wire tests check both REST and events.
- A player sees an actor's token name and image even when they cannot open the actor; GMs who want an unknown figure use a token standing alone.
- Live moves cost a refetch of the scene's tokens per change, which is small at 500 tokens per scene and keeps filtering on the server.
