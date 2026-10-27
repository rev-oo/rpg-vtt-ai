import { z } from 'zod';

// Compendium packs (FR-PLUGIN-09, ADR-051): the system's packs, which GMs import into a table.

/** A pack of the table's system, as GMs and assistants see it in the list. */
export const packSummarySchema = z.object({
  /** The file name under `packs/`, without `.json`. */
  name: z.string(),
  /** A lang key of the system, or text. */
  label: z.string(),
  actors: z.number().int().min(0),
  items: z.number().int().min(0),
  /** Entries already in the table, live or in the trash. */
  imported: z.number().int().min(0),
});
export type PackSummary = z.infer<typeof packSummarySchema>;

export const packsResponseSchema = z.object({ packs: z.array(packSummarySchema) });

/** `POST /tables/:id/packs/:name/import`: what it created, and what was already there. */
export const packImportResponseSchema = z.object({
  created: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type PackImportResponse = z.infer<typeof packImportResponseSchema>;
