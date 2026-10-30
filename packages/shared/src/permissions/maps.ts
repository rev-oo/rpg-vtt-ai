import type { TableRole } from '../roles.js';

import { canEditActor } from './entities.js';
import { isGmLike, type Ownership, type Subject } from './ownership.js';

/**
 * Who sees a token (FR-MAP-03, ADR-068): GMs and assistants every token; others only the
 * tokens of the scene players are shown, unless hidden.
 */
export function canSeeToken(
  role: TableRole,
  token: { hidden: boolean; sceneActive: boolean },
): boolean {
  return isGmLike(role) || (token.sceneActive && !token.hidden);
}

/**
 * Who moves a token (FR-MAP-03, ADR-068): GMs and assistants any; others the tokens of actors
 * they own, while they can see them. A token standing alone has no owner but the GM.
 */
export function canMoveToken(
  subject: Subject,
  token: { hidden: boolean; sceneActive: boolean; actorOwnership: Ownership | null },
): boolean {
  if (isGmLike(subject.role)) return true;
  if (!canSeeToken(subject.role, token) || token.actorOwnership === null) return false;
  return canEditActor(subject, token.actorOwnership);
}
