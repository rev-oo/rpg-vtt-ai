import { useRouteLoaderData } from 'react-router';

import type { ActorView, MemberView, TableTypes, TableView } from '@vtt/shared/api';

import type { ChatPage } from '../chat/messages.js';

/** What the table page loads once for all its tabs. */
export interface TableData {
  table: TableView;
  members: MemberView[];
  /** Every actor the user can see, unfiltered: speakers and copy targets. */
  actors: ActorView[];
  types: TableTypes;
  chat: ChatPage;
}

export type TableLoaderData = { data: TableData; error: null } | { data: null; error: string };

/** The id React Router gives `routes/table.tsx`. */
export const TABLE_ROUTE_ID = 'routes/table';

/** The table page's data, for its tabs. Only usable below a loaded table page. */
export function useTableData(): TableData {
  const loaded = useRouteLoaderData<TableLoaderData>(TABLE_ROUTE_ID);
  if (!loaded?.data) throw new Error('useTableData used outside a loaded table page');
  return loaded.data;
}
