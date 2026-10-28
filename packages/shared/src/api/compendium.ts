import { z } from 'zod';

import { MAX_ENTITY_TYPE, MAX_LIST_PAGE, MAX_SEARCH } from './constants.js';
import { actorSchema, itemSchema } from './responses.js';

// The compendium browser (FR-PLUGIN-09, ADR-060): the entries of the table's system's packs,
// which members browse and copy into the table or onto their actors.

/** At most this many entries are copied at once. */
export const MAX_COMPENDIUM_COPY = 50;
/** An entry's ref is `<plugin>:<pack>:<entry id>`. */
const MAX_PACK_REF = 300;

export const COMPENDIUM_KINDS = ['actor', 'item'] as const;
export type CompendiumKind = (typeof COMPENDIUM_KINDS)[number];

/** `GET /tables/:id/compendium`: filters and a page of entries, ordered by name (ADR-057). */
export const compendiumQuery = z.object({
  /** Case-insensitive substring of the name. */
  search: z.string().trim().max(MAX_SEARCH).optional(),
  /** A pack's file name under `packs/`. */
  pack: z.string().min(1).max(64).optional(),
  kind: z.enum(COMPENDIUM_KINDS).optional(),
  type: z.string().min(1).max(MAX_ENTITY_TYPE).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_PAGE).optional(),
  cursor: z.string().max(512).optional(),
});
export type CompendiumQuery = z.input<typeof compendiumQuery>;

/** A pack of the system, for the pack filter. */
export const compendiumPackSchema = z.object({
  /** The file name under `packs/`, without `.json`. */
  name: z.string(),
  /** A lang key of the system, or text. */
  label: z.string(),
});
export type CompendiumPack = z.infer<typeof compendiumPackSchema>;

export const compendiumEntrySchema = z.object({
  /** `<plugin>:<pack>:<entry id>`, kept by copies as their `pack_ref`. */
  ref: z.string(),
  pack: z.string(),
  kind: z.enum(COMPENDIUM_KINDS),
  type: z.string(),
  name: z.string(),
  /** The entry's data as a copy starts with it, without the fields the caller may not see. */
  system: z.record(z.string(), z.unknown()),
  /** Whether the table's actors or library already hold a copy, live or in the trash. */
  inTable: z.boolean(),
});
export type CompendiumEntry = z.infer<typeof compendiumEntrySchema>;

export const compendiumPageSchema = z.object({
  packs: z.array(compendiumPackSchema),
  entries: z.array(compendiumEntrySchema),
  nextCursor: z.string().nullable(),
});
export type CompendiumPage = z.infer<typeof compendiumPageSchema>;

/**
 * `POST /tables/:id/compendium/copy`. Without `actorId`, GMs and assistants copy actors and
 * items into the table; with it, the actor's owners copy items onto it.
 */
export const compendiumCopyBody = z.object({
  refs: z.array(z.string().min(1).max(MAX_PACK_REF)).min(1).max(MAX_COMPENDIUM_COPY),
  actorId: z.uuid().optional(),
});
export type CompendiumCopyInput = z.input<typeof compendiumCopyBody>;

/** What the copy created. */
export const compendiumCopyResponseSchema = z.object({
  actors: z.array(actorSchema),
  items: z.array(itemSchema),
});
export type CompendiumCopyResponse = z.infer<typeof compendiumCopyResponseSchema>;
