import type { ReactElement } from 'react';

import type { EntityListQuery, ItemView } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { readFilters, toListQuery } from '../features/entities/filters.js';
import { ItemList } from '../features/entities/ItemList.js';
import { LIST_PAGE } from '../features/entities/paging.js';
import { useTableData } from '../features/table/table-data.js';

import type { Route } from './+types/table-items';

interface ItemsData {
  /** The first page; the list loads the rest (ADR-057). */
  items: ItemView[];
  nextCursor: string | null;
  query: EntityListQuery;
  trash: boolean;
  error: string | null;
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<ItemsData> {
  const filters = readFilters(new URL(request.url));
  const query = { ...toListQuery(filters), limit: LIST_PAGE };
  try {
    const page = await api.itemsPage(params.tableId, query);
    return {
      items: page.rows,
      nextCursor: page.nextCursor,
      query,
      trash: filters.trash,
      error: null,
    };
  } catch (error) {
    return { items: [], nextCursor: null, query, trash: filters.trash, error: errorMessage(error) };
  }
}

/** The item library tab of a table. */
export default function TableItemsRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const data = useTableData();
  const { query, ...rest } = loaderData;
  return (
    <ItemList
      data={data}
      {...rest}
      fetchPage={(cursor) => api.itemsPage(data.table.id, { ...query, cursor })}
    />
  );
}
