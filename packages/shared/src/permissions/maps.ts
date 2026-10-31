import { canEditActor } from './entities.js';
import { isGmLike, type Ownership, type Subject } from './ownership.js';

/** What a token's visibility and movement depend on. */
export interface TokenFacts {
  hidden: boolean;
  sceneActive: boolean;
  /** It stands in the scene's fog of war (ADR-070). */
  fogged: boolean;
  /** Its actor's ownership; `null` for a token standing alone. */
  actorOwnership: Ownership | null;
}

/**
 * Who sees a token (FR-MAP-03, FR-MAP-04): GMs and assistants every token; others only the
 * tokens of the scene players are shown, unless hidden. A token in the fog shows only to
 * the owners of its actor, who know where their character stands (ADR-070).
 */
export function canSeeToken(subject: Subject, token: TokenFacts): boolean {
  if (isGmLike(subject.role)) return true;
  if (!token.sceneActive || token.hidden) return false;
  return !token.fogged || ownsActor(subject, token);
}

const ownsActor = (subject: Subject, { actorOwnership }: TokenFacts) =>
  actorOwnership !== null && canEditActor(subject, actorOwnership);

/**
 * Who moves a token (FR-MAP-03, ADR-068): GMs and assistants any; others the tokens of actors
 * they own, while they can see them. A token standing alone has no owner but the GM.
 */
export function canMoveToken(subject: Subject, token: TokenFacts): boolean {
  if (isGmLike(subject.role)) return true;
  return canSeeToken(subject, token) && ownsActor(subject, token);
}
