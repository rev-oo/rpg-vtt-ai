import type { ActorLayer } from './permissions/index.js';

/** A collaborative document (specs §9.1): what `<kind>:<id>:<layer>` names. */
export type DocumentRef =
  | { kind: 'actor'; id: string; layer: ActorLayer }
  | { kind: 'item'; id: string; layer: ActorLayer }
  | { kind: 'journal'; id: string; layer: 'main' };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DOCUMENT_NAME = new RegExp(
  `^(?:(actor|item):(${UUID}):(main|secret)|journal:(${UUID}):main)$`,
);

/** The name of a collaborative document (specs §9.1). */
export function documentName(ref: DocumentRef): string {
  return `${ref.kind}:${ref.id}:${ref.layer}`;
}

/**
 * Parses a document name, or returns `null` for anything that is not exactly one of the names of
 * specs §9.1. The name only routes: access is decided from the entity it names.
 */
export function parseDocumentName(name: string): DocumentRef | null {
  const match = DOCUMENT_NAME.exec(name);
  if (!match) return null;
  const [, kind, entityId, layer, journalId] = match;
  if ((kind === 'actor' || kind === 'item') && entityId !== undefined) {
    if (layer === 'main' || layer === 'secret') return { kind, id: entityId, layer };
  }
  if (journalId !== undefined) return { kind: 'journal', id: journalId, layer: 'main' };
  return null;
}
