import { z } from 'zod';

import { formula, schemaUrl } from './common.js';

/** `combat.json`: initiative (FR-COMBAT-02, v1). Only the shape is fixed for now. */
export const combatSchema = z.strictObject({
  ...schemaUrl,
  initiative: formula.optional(),
  order: z.enum(['desc', 'asc', 'sideBased']).optional(),
});
export type Combat = z.infer<typeof combatSchema>;
