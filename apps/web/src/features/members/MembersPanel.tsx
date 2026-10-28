import { useEffect, useState, type ReactElement } from 'react';

import type { InviteView } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { useSession } from '../../shell/use-session.js';
import { useTableData } from '../table/table-data.js';

import { InviteManager } from './InviteManager.js';
import { MemberList } from './MemberList.js';

type Invites =
  | { status: 'loading' }
  /** `invites` is `null` for members who may not manage invites. */
  | { status: 'ready'; invites: InviteView[] | null }
  | { status: 'failed'; error: string };

/** The members panel: the member list, and the invite links for the GM (FR-TABLE-03, 04). */
export function MembersPanel(): ReactElement {
  const data = useTableData();
  const { user } = useSession();
  const tableId = data.table.id;
  const [invites, setInvites] = useState<Invites>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    api.listInvites(tableId).then(
      (list) => {
        if (current) setInvites({ status: 'ready', invites: list });
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 403) {
          setInvites({ status: 'ready', invites: null });
        } else {
          setInvites({ status: 'failed', error: errorMessage(error) });
        }
      },
    );
    return () => {
      current = false;
    };
    // A revalidation (after an invite is made or revoked) reloads them.
  }, [tableId, data]);

  return (
    <div className="flex flex-col gap-6">
      {invites.status === 'failed' && <Alert tone="error">{invites.error}</Alert>}
      {user && <MemberList data={data} userId={user.id} />}
      {invites.status === 'ready' && invites.invites && (
        <InviteManager tableId={tableId} invites={invites.invites} />
      )}
    </div>
  );
}
