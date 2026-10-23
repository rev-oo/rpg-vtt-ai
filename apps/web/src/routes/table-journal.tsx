import type { ReactElement } from 'react';

import type { JournalEntryView } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { readFilters } from '../features/entities/filters.js';
import { JournalList } from '../features/journal/JournalList.js';
import { useTableData } from '../features/table/table-data.js';

import type { Route } from './+types/table-journal';

interface JournalData {
  entries: JournalEntryView[];
  trash: boolean;
  error: string | null;
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<JournalData> {
  const { search, trash } = readFilters(new URL(request.url));
  try {
    const entries = await api.listJournal(params.tableId, {
      ...(search.trim() && { search: search.trim() }),
      trash: trash ? 'restorable' : 'live',
    });
    return { entries, trash, error: null };
  } catch (error) {
    return { entries: [], trash, error: errorMessage(error) };
  }
}

/** The journal tab of a table. */
export default function TableJournalRoute({ loaderData }: Route.ComponentProps): ReactElement {
  return <JournalList data={useTableData()} {...loaderData} />;
}
