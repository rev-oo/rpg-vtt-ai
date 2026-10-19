import type { TableRole } from '../roles.js';

/** Ownership levels (FR-ENT-03): `observer` reads, `owner` reads and edits. */
export const OWNERSHIP_LEVELS = ['none', 'observer', 'owner'] as const;
export type OwnershipLevel = (typeof OWNERSHIP_LEVELS)[number];

/** A default level plus per-user levels (FR-ENT-02). A per-user level overrides the default. */
export interface Ownership {
  default: OwnershipLevel;
  users: Readonly<Partial<Record<string, OwnershipLevel>>>;
}

/** The member a permission is checked for. */
export interface Subject {
  userId: string;
  role: TableRole;
}

/** GMs and assistants: implicit owners of every actor and journal entry, and see GM-only data. */
export function isGmLike(role: TableRole): boolean {
  return role === 'gm' || role === 'assistant';
}

/**
 * The level a member effectively has on an entity. GMs and assistants are implicit owners
 * (FR-ENT-03, specs §9.3); spectators never edit, so they are capped at `observer`.
 */
export function effectiveOwnership(subject: Subject, ownership: Ownership): OwnershipLevel {
  if (isGmLike(subject.role)) return 'owner';
  const level = ownership.users[subject.userId] ?? ownership.default;
  if (subject.role === 'spectator' && level === 'owner') return 'observer';
  return level;
}
