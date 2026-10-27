import { z } from 'zod';

import { formula, schemaUrl } from './common.js';

/** `combat.json`: initiative for the combat tracker (FR-COMBAT-02, ADR-050). */
export const combatSchema = z
  .strictObject({
    ...schemaUrl,
    initiative: formula
      .optional()
      .describe(
        'What each combatant rolls for initiative, against its actor’s data. Free-form combatants roll without data.',
      ),
    order: z
      .enum(['desc', 'asc', 'sideBased'])
      .optional()
      .describe(
        'Turn order: highest first (`desc`, the default), lowest first (`asc`), or `sideBased`: the side with the best roll acts first, then the other, each highest first. A side is the actor type’s `controlledBy`; free-form combatants are on the GM’s side. An `orderCombatants` hook replaces the rule.',
      ),
  })
  .describe('Initiative for the combat tracker.');
export type Combat = z.infer<typeof combatSchema>;
