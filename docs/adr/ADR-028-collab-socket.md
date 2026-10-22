# ADR-028: Collaboration socket

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0501
- **Refines:** ADR-002, specs §9.3, §10.3

## Context

T-0501 mounts Hocuspocus on `/ws/collab` with session authentication and the access rules of §9.3. Hocuspocus 4 ships its own HTTP server, but the app already serves `/ws/events` through `@fastify/websocket` on one port (§14 Q7).

## Decision

1. **One port, one WebSocket plugin.**
   - `/ws/collab` is a `@fastify/websocket` route. It hands each socket to `Hocuspocus.handleConnection` and forwards messages, pongs and the close. The Hocuspocus `Server` class is not used.
   - The upgrade needs a session and a same-origin page, like `/ws/events` (`realtime/upgrade.ts`).
2. **The session cookie is the credential.**
   - The token in the Hocuspocus auth message is ignored. The user and the session token are fixed when the socket opens.
   - `onAuthenticate` re-validates the session and checks access for every document the socket opens.
3. **Document names only route.**
   - `@vtt/shared` parses `<kind>:<id>:<layer>` strictly (`parseDocumentName`). Anything else is refused.
   - Access comes from the entity: a live actor or journal entry, the user's membership, and `actorLayerAccess` or `journalAccess` (§9.3). Unknown or deleted entities and non-members are refused alike, so a refusal does not reveal whether an entity exists.
   - A table whose system plugin is unavailable is read-only on the REST API (FR-PLUGIN-07). Its documents open read-only too.
4. **Access is checked again before every message.**
   - `beforeHandleMessage` repeats the check. Read access sets the connection read-only, so Hocuspocus drops the client's updates and answers with a failed sync status.
   - Lost access, or an ended session, closes the document with `Forbidden` (4403) or `Unauthorized` (4401).
   - Every refusal is logged at `warn` as `collab access denied`, with the user, the document name and the reason.
   - Disconnecting clients when access changes, without waiting for their next message, is T-0512.
5. **Refusals don't reach the console.** Hocuspocus prints the `message` of any hook error. So a refusal rejects with an `Error` that has an empty message and the close event's `code` and `reason`.
6. **Frame limits per route.**
   - `@fastify/websocket` has one `maxPayload` for every route. It is now 1 MiB (`MAX_COLLAB_MESSAGE_BYTES`), because a Yjs update can carry a whole sheet.
   - `/ws/events` keeps its 16 KiB limit by checking frames itself, and closes with 1009 as `ws` did before.
7. **Shutdown.** The collab `preClose` hook runs before the WebSocket plugin's own hook and closes its sockets with 1001, like the events hub.

## Consequences

- No document is stored yet. Documents live in memory until T-0502 adds persistence.
- Tests speak the Hocuspocus protocol through `test/support/collab.ts`, built on `y-protocols`, over `app.injectWS`. T-0503's wire-level secret test can reuse it.
