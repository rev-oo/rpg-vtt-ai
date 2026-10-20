# ADR-016: Events socket and chat

- **Status:** Accepted
- **Date:** 2026-10-20
- **Tasks:** T-0203, T-0204, T-0205, T-0206
- **Amends:** §10.2 (adds the `ack` event and the socket close code)

## Context

M2 adds the `/ws/events` socket (§10.2), entity change notifications (FR-ENT-07) and table chat (FR-CHAT-01, 02, 07). §10.2 fixes the envelope and the audience rules but leaves open how clients learn that a message was accepted, how sockets track logouts and membership changes, and how history is ordered.

## Decision

1. **Transport.** `@fastify/websocket` (on `ws`) serves `/ws/events` from the API server, so upgrades share the request pipeline: the session cookie is resolved by the same hook as REST.
2. **Upgrade checks.**
   - No session: `401`.
   - A browser `Origin` other than `PUBLIC_URL` or the request's own host: `403`. Cookies are sent on cross-site WebSocket upgrades too (cross-site WebSocket hijacking), and the CSRF header cannot be set on an upgrade.
3. **Replies.** A client message that carries an `id` gets `ack` (`{ replyTo }`) or `error` (`{ code, message, replyTo }`) back.
   - Codes: `invalid_message`, `unsupported_version` (with `supportedVersions`), `not_found`, `forbidden`, the REST codes of `chat.send`, and `not_implemented` for `roll.request` until M3.
   - `presence.ping` is only acknowledged until presence is built.
4. **Session and membership checks.**
   - The session is checked on every client message and on each 25 s heartbeat. A socket whose session ended is closed with code `4401`.
   - Sockets that miss a heartbeat pong are dropped.
   - Membership is checked at subscribe time and again on every publish, so a removed member stops receiving events at once.
5. **`entity.changed`** carries only `{ kind, id, change, actorId }`; clients refetch over REST.
   - It reaches members who can see the entity: library items reach everyone, owned items follow their actor.
   - After an ownership change, it also reaches members who could see the actor before, so their lists drop it.
6. **Chat storage.**
   - `chat_messages` has an autoincrement `seq`. History is ordered and paged on it, because several messages can share a millisecond.
   - The cursor is opaque. Pages default to 50, at most 100.
   - Audience filtering runs in the SQL query, so pages stay full.
7. **Chat rules** (one implementation for `POST /tables/:id/messages` and `chat.send`):
   - Spectators cannot post (`canSendChat`, §2).
   - Speaking as an actor needs owner access to it, so GMs and assistants may speak as any actor. Anything else gets `422 invalid_speaker`, the same answer for hidden actors.
   - Whisper recipients must be other members of the table (`422 invalid_recipient`). The sender is dropped from the list, since senders always see their own messages.
   - The speaker's name and image are snapshotted. On account deletion, `sender_id` becomes `null` and the snapshot keeps the name (FR-AUTH-06).
8. **Limits.** Frames are capped at 16 KiB and chat text at 2,000 characters. There is no per-socket rate limit yet.

## Consequences

- The web client (T-0207, T-0208) can show sent messages from the `ack` and the fan-out, without echoing them locally.
- The dev server must proxy `/ws` with WebSocket support (`ws: true`) when the chat UI lands.
- A per-socket rate limit is still to come, once rolls (M3) make messages more expensive.
