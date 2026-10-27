import { z } from 'zod';

import { MAX_ENTITY_NAME } from './constants.js';

// Combat (FR-COMBAT-01, 03, 04; ADR-049): a table's one encounter, run by the GM.

/** A combatant as one member may see it. */
export const combatantSchema = z.object({
  id: z.string(),
  /** The actor behind it, when the member may see that actor; otherwise `null`. */
  actorId: z.string().nullable(),
  name: z.string(),
  initiative: z.number().nullable(),
  /** Only GMs and assistants receive hidden combatants (FR-COMBAT-04). */
  hidden: z.boolean(),
});
export type CombatantView = z.infer<typeof combatantSchema>;

/** The encounter as one member may see it, its combatants in turn order. */
export const encounterSchema = z.object({
  id: z.string(),
  /** 0 until the encounter starts. */
  round: z.number().int().min(0),
  /** The combatant whose turn it is; `null` before the start, or when hidden from the member. */
  currentId: z.string().nullable(),
  combatants: z.array(combatantSchema),
});
export type EncounterView = z.infer<typeof encounterSchema>;

/** `GET`, and the answer of every change: `null` when the table has no encounter. */
export const encounterResponseSchema = z.object({ encounter: encounterSchema.nullable() });
export type EncounterResponse = z.infer<typeof encounterResponseSchema>;

const initiative = z.number().min(-1_000_000).max(1_000_000).nullable();

/** `POST /tables/:id/encounter/combatants`: an actor of the table, or a free-form entry. */
export const combatantCreateBody = z
  .object({
    actorId: z.uuid().optional(),
    /** Defaults to the actor's name; required without an actor. */
    name: z.string().trim().min(1).max(MAX_ENTITY_NAME).optional(),
    initiative: initiative.default(null),
    hidden: z.boolean().default(false),
  })
  .refine((body) => body.actorId !== undefined || body.name !== undefined, {
    message: 'A free-form combatant needs a name.',
    path: ['name'],
  });
export type CombatantCreateInput = z.input<typeof combatantCreateBody>;

/** `PATCH /tables/:id/encounter/combatants/:combatantId`. */
export const combatantUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(MAX_ENTITY_NAME),
    initiative,
    hidden: z.boolean(),
  })
  .partial();
export type CombatantUpdateInput = z.input<typeof combatantUpdateBody>;

/** `POST /tables/:id/encounter/turn`: moves the turn; past the last combatant, a new round. */
export const turnBody = z.object({ direction: z.enum(['next', 'previous']) });
export type TurnInput = z.input<typeof turnBody>;

/**
 * `POST /tables/:id/encounter/initiative`: rolls the system's initiative (FR-COMBAT-02) for
 * these combatants, or for every one without initiative.
 */
export const initiativeBody = z.object({
  combatantIds: z.array(z.string().min(1).max(64)).max(200).optional(),
});
export type InitiativeInput = z.input<typeof initiativeBody>;
