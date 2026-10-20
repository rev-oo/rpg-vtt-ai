import type { TableRole } from '../roles.js';

import { effectiveOwnership, isGmLike, type Ownership, type Subject } from './ownership.js';

/** Who an actor type is meant for, as declared by the system plugin. */
export type ControlledBy = 'player' | 'gm';

export const ACTOR_LAYERS = ['main', 'secret'] as const;
export type ActorLayer = (typeof ACTOR_LAYERS)[number];

export type DocumentAccess = 'none' | 'read' | 'write';

export function canViewActor(subject: Subject, ownership: Ownership): boolean {
  return effectiveOwnership(subject, ownership) !== 'none';
}

export function canEditActor(subject: Subject, ownership: Ownership): boolean {
  return effectiveOwnership(subject, ownership) === 'owner';
}

/**
 * Actor creation (FR-ENT-01): GMs and assistants create any type; players only
 * `controlledBy: "player"` types unless the GM allows all; spectators none.
 */
export function canCreateActor(
  role: TableRole,
  controlledBy: ControlledBy,
  playersMayCreateAnyType = false,
): boolean {
  if (isGmLike(role)) return true;
  if (role === 'player') return controlledBy === 'player' || playersMayCreateAnyType;
  return false;
}

/** The table's item library (FR-ENT-05) is curated by GMs and assistants; every member reads it. */
export function canManageItemLibrary(role: TableRole): boolean {
  return isGmLike(role);
}

/** Ownership levels are set by GMs and assistants only (FR-ENT-02). */
export function canSetOwnership(role: TableRole): boolean {
  return isGmLike(role);
}

/** Access to an actor's CRDT layer (specs §9.3). The secret layer is GM and assistant only. */
export function actorLayerAccess(
  subject: Subject,
  ownership: Ownership,
  layer: ActorLayer,
): DocumentAccess {
  if (layer === 'secret') return isGmLike(subject.role) ? 'write' : 'none';
  return levelToAccess(effectiveOwnership(subject, ownership));
}

/** A journal entry's access settings (FR-JOURNAL-02). */
export interface JournalAccess {
  ownership: Ownership;
  /** Hidden entries are GM and assistant only, whatever their ownership (specs §9.3). */
  hidden: boolean;
}

/** Players see new journal entries read-only by default (FR-JOURNAL-02). */
export const DEFAULT_JOURNAL_OWNERSHIP: Ownership = { default: 'observer', users: {} };

export function canCreateJournal(role: TableRole): boolean {
  return isGmLike(role);
}

export function journalAccess(subject: Subject, entry: JournalAccess): DocumentAccess {
  if (isGmLike(subject.role)) return 'write';
  if (entry.hidden) return 'none';
  return levelToAccess(effectiveOwnership(subject, entry.ownership));
}

export function canViewJournal(subject: Subject, entry: JournalAccess): boolean {
  return journalAccess(subject, entry) !== 'none';
}

export function canEditJournal(subject: Subject, entry: JournalAccess): boolean {
  return journalAccess(subject, entry) === 'write';
}

function levelToAccess(level: Ownership['default']): DocumentAccess {
  return level === 'owner' ? 'write' : level === 'observer' ? 'read' : 'none';
}
