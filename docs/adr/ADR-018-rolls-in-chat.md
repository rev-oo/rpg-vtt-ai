# ADR-018: Rolls in chat

- **Status:** Accepted
- **Date:** 2026-10-20
- **Tasks:** T-0305
- **Amends:** §10.1 (the `rolls` endpoint takes formulas until M4), §10.2 (`roll.result` is not sent)

## Context

T-0305 connects the formula engine (ADR-017) to the chat. A user types `/r 2d6+3` or `/gmr 1d20` (FR-CHAT-08), and the server rolls it and posts a roll message (FR-CHAT-03, 04). Secret rolls must not reach players (FR-CHAT-05). §10.1 says the endpoint takes "a roll recipe or a formula", and §10.2 lists a `roll.result` event, but neither says what is sent.

## Decision

1. **Endpoint.** `POST /tables/:id/rolls` takes `{ formula, audience, recipientIds, actorId }` (`rollRequestBody` in `@vtt/shared/api`).
   - The `roll.request` socket event takes the same payload and gets `ack` or `error`.
   - Formulas are trimmed and are at most 500 characters long.
   - Roll recipes join this endpoint with the plugin engine (T-0407); `rolls.json` and `dice.json` do not exist before M4.
2. **Roll messages.** A roll is a chat message of kind `roll`:
   - `text` is the formula, and `rolls` holds the result (`rollSchema`: expression, resolved expression, every die, total).
   - It reaches clients as `chat.message`, like any other message, so history, paging and audience filtering need nothing new. No `roll.result` event is sent.
3. **Audiences.** A roll message uses the chat audiences:
   - `gm` reaches the sender, the GM and assistants, and nobody else, on the wire and in history. Players do not learn that a secret roll happened (FR-CHAT-05).
   - Whispers reach their recipients.
   - In the web composer, `/gmr` is always `gm`, while `/r` takes the audience chosen for messages.
4. **Speaker and data.** `actorId` works as for text messages: only an owner may roll as an actor. The roll then reads that actor's `system` data (FR-DICE-02).
   - Without an actor there is no data, so `@` references fail.
   - Derived values and custom dice come from the plugin engine (M4).
5. **Randomness.** The server rolls with `crypto.randomInt` (FR-CHAT-04). The app takes an `rng` option so tests can pass a scripted or seeded one.
6. **Errors.**
   - A formula that does not parse or evaluate is `422 invalid_formula`. Its message is the formula engine's English message, with line and column.
   - `details` holds `{ reason, line, column }`, where `reason` is the `FormulaError` code, so a client can word it differently later (pt-BR, T-0703).
   - Spectators get `403`, as for chat.

## Consequences

- The wire test sends public, secret and whispered rolls to a GM, two players and a spectator. Nothing of a secret roll reaches a player's socket, and history filters it the same way. The browser test checks the same with three sessions.
- The web renders each roll: the expression, the resolved expression when it differs, every die and the total. Dice that do not count are struck through, explosions are marked `!`, and successes and failures are outlined.
