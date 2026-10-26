import { z } from 'zod';

import { formula, schemaUrl } from './common.js';

/** `combat.json`: initiative (FR-COMBAT-02, v1). Only the shape is fixed for now. */
export const combatSchema = z
  .strictObject({
    ...schemaUrl,
    initiative: formula.optional().describe('What each combatant rolls for initiative.'),
    order: z.enum(['desc', 'asc', 'sideBased']).optional(),
  })
  .describe('Initiative for the combat tracker. Checked, but not used until the tracker ships.');
export type Combat = z.infer<typeof combatSchema>;
