# ADR-052: Chat edits and deletes go to the message's audience

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0805
- **Covers:** FR-CHAT-09

## Context

FR-CHAT-09 lets authors edit or delete their messages for 5 minutes and GMs delete any message. Messages have an audience enforced on delivery and in history (FR-CHAT-02), so a change must not tell anyone about a message they never saw. Roll and card messages are made by the server (FR-CHAT-03); their author did not write their content.

## Decision

1. **Rules.** Shared in `@vtt/shared` (`canEditMessage`, `canDeleteMessage`) so the server enforces them and the web shows the buttons:
   - the author edits or deletes their own `text` message for 5 minutes after sending it;
   - GMs and assistants delete any message they can see, of any kind, at any time;
   - nobody edits a roll or a card, and nobody edits another member's message.
2. **Endpoints.** `PATCH /messages/:id` with `{ text }` answers the edited message; `DELETE /messages/:id` answers 204. A message the caller cannot see answers 404, as if it did not exist; one they see but may not change answers 403.
3. **Edits.** The text is replaced and `editedAt` set; the old text is not kept. Clients mark edited messages.
4. **Deletes are permanent.** Messages have no trash. The web asks the user to confirm.
5. **Events.** `chat.updated` (the message) and `chat.deleted` (its id) go to the subscribers the message's audience allows, the same filter as `chat.message`. A deleted whisper therefore goes from its recipients' logs too, and others hear nothing.

## Consequences

- A GM cannot delete a whisper they were not part of; they never see it.
- An edit replaces history: other members see only the new text and the edited mark.
- The window is checked against the server clock; the web hides its buttons when the window closes, and the server refuses a late request.
