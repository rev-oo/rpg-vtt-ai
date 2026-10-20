import type { ReactElement } from 'react';

import type { ItemView } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { readFilters, toListQuery } from '../features/entities/filters.js';
import { ItemList } from '../features/entities/ItemList.js';
import { useTableData } from '../features/table/table-data.js';

import type { Route } from './+types/table-items';

interface ItemsData {
  items: ItemView[];
  trash: boolean;
  error: string | null;
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<ItemsData> {
  const filters = readFilters(new URL(request.url));
  try {
    const items = await api.listItems(params.tableId, toListQuery(filters));
    return { items, trash: filters.trash, error: null };
  } catch (error) {
    return { items: [], trash: filters.trash, error: errorMessage(error) };
  }
}

/** The item library tab of a table. */
export default function TableItemsRoute({ loaderData }: Route.ComponentProps): ReactElement {
  return <ItemList data={useTableData()} {...loaderData} />;
}
