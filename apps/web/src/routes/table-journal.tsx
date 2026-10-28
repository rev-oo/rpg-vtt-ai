import { redirect } from 'react-router';

import type { Route } from './+types/table-journal';

/** The old list page: the list now lives in the workspace's browse panel (ADR-059). */
export function clientLoader({ params, request }: Route.ClientLoaderArgs): Response {
  const search = new URL(request.url).searchParams;
  search.set('panel', 'journal');
  return redirect(`/tables/${params.tableId}?${search.toString()}`);
}

export default function TableLegacyJournalRoute(): null {
  return null;
}
