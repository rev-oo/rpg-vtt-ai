import type { EntityListQuery } from '@vtt/shared/api';

/** List filters, kept in the URL so they survive reloads and can be shared (FR-ENT-04). */
export interface EntityFilters {
  search: string;
  type: string;
  /** Show the trash instead of live entities. */
  trash: boolean;
}

export function readFilters(url: URL): EntityFilters {
  const params = url.searchParams;
  return {
    search: params.get('q') ?? '',
    type: params.get('type') ?? '',
    trash: params.get('trash') === '1',
  };
}

export function toListQuery(filters: EntityFilters): EntityListQuery {
  return {
    ...(filters.search.trim() && { search: filters.search.trim() }),
    ...(filters.type && { type: filters.type }),
    trash: filters.trash ? 'restorable' : 'live',
  };
}
