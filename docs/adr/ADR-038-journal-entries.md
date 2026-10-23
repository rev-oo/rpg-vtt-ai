# ADR-038: Journal entries over REST and collab

- **Status:** Accepted
- **Date:** 2026-10-23
- **Tasks:** T-0601
- **Refines:** specs §9.3, §10, FR-JOURNAL-01..03

## Context

T-0601 needs create, list, hide/reveal and ownership for journal entries. M2 built the `journal_entries` table and its repository, and the permissions `journalAccess`, `canViewJournal` and `canCreateJournal`. M5 built the collab access check for `journal:<id>:main`. What was missing is the HTTP API, live list updates and a decision on where the body lives in its document.

## Decision

1. **Routes**, shaped like the actor routes:
   - `GET /tables/:id/journal` (`search`, `trash`) and `POST /tables/:id/journal`;
   - `GET/PATCH/DELETE /journal/:id` and `POST /journal/:id/restore`.
   - The schemas are `createJournalBody`, `updateJournalBody` and `journalEntrySchema` in `@vtt/shared/api`.
2. **Who may do what:**
   - GMs and assistants create, delete and restore entries, hide or reveal them, and set their ownership.
   - A player who owns an entry may rename it, but sending `hidden` or `ownership` gets 403.
   - Observers read.
   - Ownership defaults to `observer` for everyone (FR-JOURNAL-02).
   - Edits need a writable table, as collab does (FR-PLUGIN-07).
3. **New entries start hidden.** A GM prepares an entry and reveals it when the players should see it. `hidden: false` on create shares it at once.
4. **Hidden means absent:**
   - For players, the list query leaves hidden entries out in SQL.
   - `GET /journal/:id` answers 404, as for an entry of another table, so ids cannot be probed.
   - The document is refused, as §9.3 already does.
   - Hiding an open entry closes players' documents through the re-check after every change (ADR-036).
5. **Events:**
   - `entity.changed` gains the kind `journal`. It reaches members who can see the entry now or could before the update.
   - So the hide that removes an entry tells the players who lose it, and they refetch and get 404.
   - Changes to an entry that stays hidden reach GMs and assistants only.
6. **The body is the document's root `Y.XmlFragment` named `body`.**
   - It is edited with TipTap as `richText` fields are (ADR-037).
   - Root types cannot be lost to concurrent creation, so nothing has to create it on load.
   - Journal documents have no projection. The title stays in SQL.
7. **The journal UI is built in the M6 web PR**, with the members and settings pages, not in T-0601.

## Consequences

- Tested on the wire in `apps/server/test/journal.test.ts`: lists, 404s, refused documents, the reveal, the closed document on hide, and the events.
- The plain text of a body is not stored anywhere outside its document; search covers titles only.
