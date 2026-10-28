import type { TableRole } from '../roles.js';

import { isGmLike } from './ownership.js';

/** Table settings, system options and roles are GM only (FR-TABLE-07). */
export function canManageTable(role: TableRole): boolean {
  return role === 'gm';
}

/** Changing roles and removing other members (FR-TABLE-04). */
export function canManageMembers(role: TableRole): boolean {
  return role === 'gm';
}

/** Creating, listing and revoking invite links (FR-TABLE-03). */
export function canManageInvites(role: TableRole): boolean {
  return role === 'gm';
}

/** Archiving (FR-TABLE-06). */
export function canArchiveTable(role: TableRole): boolean {
  return isGmLike(role);
}

/** Moving the table to its system's installed version (§9.7, ADR-058). */
export function canUpgradeTableSystem(role: TableRole): boolean {
  return isGmLike(role);
}

/** Copying compendium entries into the table's actors and library (FR-PLUGIN-09). */
export function canCopyCompendiumToTable(role: TableRole): boolean {
  return isGmLike(role);
}

/** Running the table's encounter (FR-COMBAT-01). */
export function canRunCombat(role: TableRole): boolean {
  return isGmLike(role);
}

/** GM-only chat, secret rolls and secret sheet fields (FR-SHEET-04, FR-CHAT-02). */
export function canSeeGmContent(role: TableRole): boolean {
  return isGmLike(role);
}
