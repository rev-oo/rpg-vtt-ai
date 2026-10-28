import type { ReactElement } from 'react';

import type { JournalEntryView, JournalListQuery } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { readFilters } from '../features/entities/filters.js';
import { LIST_PAGE } from '../features/entities/paging.js';
import { JournalList } from '../features/journal/JournalList.js';
import { useTableData } from '../features/table/table-data.js';

import type { Route } from './+types/table-journal';

interface JournalData {
  /** The first page; the list loads the rest (ADR-057). */
  entries: JournalEntryView[];
  nextCursor: string | null;
  query: JournalListQuery;
  trash: boolean;
  error: string | null;
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<JournalData> {
  const { search, trash } = readFilters(new URL(request.url));
  const query: JournalListQuery = {
    ...(search.trim() && { search: search.trim() }),
    trash: trash ? 'restorable' : 'live',
    limit: LIST_PAGE,
  };
  try {
    const page = await api.journalPage(params.tableId, query);
    return { entries: page.rows, nextCursor: page.nextCursor, query, trash, error: null };
  } catch (error) {
    return { entries: [], nextCursor: null, query, trash, error: errorMessage(error) };
  }
}

/** The journal tab of a table. */
export default function TableJournalRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const data = useTableData();
  const { query, ...rest } = loaderData;
  return (
    <JournalList
      data={data}
      {...rest}
      fetchPage={(cursor) => api.journalPage(data.table.id, { ...query, cursor })}
    />
  );
}
