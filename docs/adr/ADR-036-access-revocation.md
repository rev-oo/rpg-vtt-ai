# ADR-036: Pushing access changes to open documents

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0512
- **Refines:** specs §9.3

## Context

Since ADR-028, a document's access is checked when it is opened and again before every message a client sends. A client that only listens sends nothing, so it kept receiving updates after it lost access. Examples are an observer who was removed from the table, or someone whose session was ended elsewhere. §9.3 asks that clients whose access drops are disconnected immediately.

Access can change in many places:

- membership and roles;
- actor ownership, deletion and restoration;
- disabled users and revoked sessions;
- disabled or rescanned plugins, which make tables read-only.

## Decision

1. **Re-check after every change, not at every change site.**
   - After any successful request other than `GET` or `HEAD`, the collab server schedules one re-check of every open document connection on the next tick. Requests in the same tick share it.
   - Every one of the changes listed above goes through the API, so no route has to remember to notify the collab server.
   - A sweep every 30 s also catches sessions that expire on their own.
2. **The same rule as before every message** (`enforce`):
   - With no access left, the document is closed with `Forbidden` (or `Unauthorized` when the session is gone), and the denial is logged.
   - When access moves between read and write, the connection's `readOnly` changes and the client gets a stateless `access {readOnly}` message (`collabServerMessage`).
3. **The client follows.**
   - `useLiveSheet` applies `access` to the sheet's read-only state.
   - A document close with a `Forbidden`/`Unauthorized` reason turns the sheet into the "cannot see it" notice. A dropped socket closes without such a reason, and the provider reconnects.

## Consequences

- Each change re-checks every open connection, a few indexed SQLite reads each. That's cheap at self-hosted scale. If many instances or tables ever share one server, the re-check can be narrowed to the documents of the changed table.
- Changes made outside the API, such as direct database edits in tests, are seen at the next message or sweep.
- Tests: `apps/server/test/collab.test.ts` covers removal, ownership changes, deletion and logout, all for clients that only listen. `e2e/tests/live-sheets.spec.ts` checks that a removed member's sheet closes within 2 s.
