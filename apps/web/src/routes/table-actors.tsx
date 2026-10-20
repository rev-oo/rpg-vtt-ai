import type { ReactElement } from 'react';

import type { ActorView } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { ActorList } from '../features/entities/ActorList.js';
import { readFilters, toListQuery } from '../features/entities/filters.js';
import { useTableData } from '../features/table/table-data.js';

import type { Route } from './+types/table-actors';

interface ActorsData {
  actors: ActorView[];
  trash: boolean;
  error: string | null;
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<ActorsData> {
  const filters = readFilters(new URL(request.url));
  try {
    const actors = await api.listActors(params.tableId, toListQuery(filters));
    return { actors, trash: filters.trash, error: null };
  } catch (error) {
    return { actors: [], trash: filters.trash, error: errorMessage(error) };
  }
}

/** The actors tab of a table. */
export default function TableActorsRoute({ loaderData }: Route.ComponentProps): ReactElement {
  return <ActorList data={useTableData()} {...loaderData} />;
}
