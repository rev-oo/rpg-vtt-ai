/** A member's role in a table (specs §3, §7.2). Ordered from most to least privileged. */
export const TABLE_ROLES = ['gm', 'assistant', 'player', 'spectator'] as const;

export type TableRole = (typeof TABLE_ROLES)[number];

/** Roles an invite link can grant (FR-TABLE-03). GM is never granted by invite. */
export const INVITE_ROLES = [
  'assistant',
  'player',
  'spectator',
] as const satisfies readonly TableRole[];

export type InviteRole = (typeof INVITE_ROLES)[number];

export function isTableRole(value: unknown): value is TableRole {
  return TABLE_ROLES.includes(value as TableRole);
}
