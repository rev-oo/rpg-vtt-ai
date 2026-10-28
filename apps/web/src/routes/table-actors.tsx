import type { ReactElement } from 'react';

import type { ActorView, EntityListQuery } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { ActorList } from '../features/entities/ActorList.js';
import { readFilters, toListQuery } from '../features/entities/filters.js';
import { LIST_PAGE } from '../features/entities/paging.js';
import { useTableData } from '../features/table/table-data.js';

import type { Route } from './+types/table-actors';

interface ActorsData {
  /** The first page; the list loads the rest (ADR-057). */
  actors: ActorView[];
  nextCursor: string | null;
  query: EntityListQuery;
  trash: boolean;
  error: string | null;
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<ActorsData> {
  const filters = readFilters(new URL(request.url));
  const query = { ...toListQuery(filters), limit: LIST_PAGE };
  try {
    const page = await api.actorsPage(params.tableId, query);
    return {
      actors: page.rows,
      nextCursor: page.nextCursor,
      query,
      trash: filters.trash,
      error: null,
    };
  } catch (error) {
    return {
      actors: [],
      nextCursor: null,
      query,
      trash: filters.trash,
      error: errorMessage(error),
    };
  }
}

/** The actors tab of a table. */
export default function TableActorsRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const data = useTableData();
  const { query, ...rest } = loaderData;
  return (
    <ActorList
      data={data}
      {...rest}
      fetchPage={(cursor) => api.actorsPage(data.table.id, { ...query, cursor })}
    />
  );
}
