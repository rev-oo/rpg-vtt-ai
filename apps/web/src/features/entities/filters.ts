import { z } from 'zod';

import type { EntityListQuery } from '@vtt/shared/api';

/**
 * List filters (FR-ENT-04). Each list panel keeps its own, saved with the workspace layout
 * (ADR-059), so two lists open side by side never share a search.
 */
export const entityFiltersSchema = z.object({
  search: z.string().max(200).catch(''),
  type: z.string().max(100).catch(''),
  /** Show the trash instead of live entities. */
  trash: z.boolean().catch(false),
});
export type EntityFilters = z.infer<typeof entityFiltersSchema>;

export const NO_FILTERS: EntityFilters = { search: '', type: '', trash: false };

/** The filters stored in a panel's parameters; none when they are missing or invalid. */
export function readFilters(value: unknown): EntityFilters {
  const parsed = entityFiltersSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : NO_FILTERS;
}

export function toListQuery(filters: EntityFilters): EntityListQuery {
  return {
    ...(filters.search.trim() && { search: filters.search.trim() }),
    ...(filters.type && { type: filters.type }),
    trash: filters.trash ? 'restorable' : 'live',
  };
}
