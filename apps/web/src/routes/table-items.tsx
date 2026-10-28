import { redirect } from 'react-router';

import type { Route } from './+types/table-items';

/** The old list page: the list now lives in the workspace's browse panel (ADR-059). */
export function clientLoader({ params, request }: Route.ClientLoaderArgs): Response {
  const search = new URL(request.url).searchParams;
  search.set('panel', 'items');
  return redirect(`/tables/${params.tableId}?${search.toString()}`);
}

export default function TableLegacyItemsRoute(): null {
  return null;
}
