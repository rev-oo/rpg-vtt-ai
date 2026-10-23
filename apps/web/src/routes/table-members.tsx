import type { ReactElement } from 'react';

import type { InviteView } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { ApiError } from '../api/client.js';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { InviteManager } from '../features/members/InviteManager.js';
import { MemberList } from '../features/members/MemberList.js';
import { useTableData } from '../features/table/table-data.js';
import { useSession } from '../shell/use-session.js';

import type { Route } from './+types/table-members';

interface MembersData {
  /** `null` for members who may not manage invites. */
  invites: InviteView[] | null;
  error: string | null;
}

export async function clientLoader({ params }: Route.ClientLoaderArgs): Promise<MembersData> {
  try {
    return { invites: await api.listInvites(params.tableId), error: null };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { invites: null, error: null };
    return { invites: null, error: errorMessage(error) };
  }
}

/** The members tab: the member list, and the invite links for the GM (FR-TABLE-03, 04). */
export default function TableMembersRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const data = useTableData();
  const { user } = useSession();
  return (
    <div className="flex flex-col gap-6">
      {loaderData.error && <Alert tone="error">{loaderData.error}</Alert>}
      {user && <MemberList data={data} userId={user.id} />}
      {loaderData.invites && <InviteManager tableId={data.table.id} invites={loaderData.invites} />}
    </div>
  );
}
