# ADR-053: Sheet history keeps copies of each actor document, restored in place

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0806
- **Covers:** FR-SHEET-11

## Context

FR-SHEET-11 keeps the last 50 snapshots of each actor for recovery. Actor data lives in two Yjs documents, `main` and `secret` (§9.1), and the secret one is for GMs and assistants only (§9.3). Documents are stored, debounced, on change (§9.6). Rich text is a `Y.XmlFragment` whose formatting a JSON copy would lose, and clients' editors stay bound to the shared types they opened.

## Decision

1. **What is kept.** Each snapshot is a Yjs update holding a copy of one document's `data` map, without its edit history, in `actor_snapshots` with the actor and the layer. The secret layer's snapshots are kept apart, so they follow the secret document's access.
2. **When.** When a document is stored, if the newest snapshot of that document is at least 5 minutes old and differs from it. The newest 50 per document are kept; older ones are deleted at once. They go with the actor when it is purged.
3. **Who.** The members who may edit a layer list and restore its snapshots: owners and GMs the main sheet, GMs and assistants the secret layer. Others get 403, and members who cannot see the actor 404. A snapshot of a layer the caller may not edit answers 404.
4. **Restore in place.** `POST /actors/:id/history/:snapshotId/restore` opens a direct connection to the document and, in one transaction, makes its data equal to the snapshot (`copyInto`): values are set, and maps, texts and rich texts keep their shared types with their content replaced, so open editors stay bound. The change reaches every open sheet like any edit, and is stored and checked (§9.7) as usual.
5. **Undo.** Before a restore, the state it replaces is kept as a snapshot, unless the newest one already holds it, so a restore can be undone by restoring that one.
6. **UI.** A History dialog on the sheet, for its owners, lists the snapshots by time and restores one.

## Consequences

- Up to 100 compact snapshots per actor are stored, two layers of 50; a busy sheet takes at most 12 an hour.
- Snapshots show only their time; there is no preview or diff.
- Restoring rewrites the sheet for everyone editing it; concurrent typing in the same moment can be lost to the restore.
