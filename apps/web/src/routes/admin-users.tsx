import { useState, type ReactElement } from 'react';
import { redirect, useRevalidator } from 'react-router';

import type { AdminUser } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { ConfirmUserAction, type UserAction } from '../features/users/ConfirmUserAction.js';
import { NewUserDialog } from '../features/users/NewUserDialog.js';
import { OneTimePassword } from '../features/users/OneTimePassword.js';
import { UserCard } from '../features/users/UserCard.js';
import { t } from '../i18n/index.js';
import { ICON } from '../icons.js';
import { adminRedirect } from '../shell/access.js';
import { loadSession } from '../shell/session.js';
import { useSession } from '../shell/use-session.js';

import type { Route } from './+types/admin-users';

type UsersData = { users: AdminUser[]; error: null } | { users: null; error: string };

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<UsersData | Response> {
  const to = adminRedirect(await loadSession(), new URL(request.url));
  if (to) return redirect(to);
  try {
    return { users: await api.listUsers(), error: null };
  } catch (error) {
    return { users: null, error: errorMessage(error) };
  }
}

/** A one-time password to hand over, with whose it is. */
interface Handover {
  user: AdminUser;
  password: string;
  reason: 'created' | 'reset';
}

/**
 * The instance's users, for admins (FR-AUTH-02, FR-AUTH-06; T-1619): create one with a one-time
 * password, reset a password, disable, make admin, delete.
 */
export default function AdminUsersRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { users, error: loadError } = loaderData;
  const { user: me } = useSession();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [confirming, setConfirming] = useState<{ user: AdminUser; action: UserAction } | null>(
    null,
  );

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await revalidator.revalidate();
      if (done) setNotice(done);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = (user: AdminUser, action: UserAction) => {
    setConfirming(null);
    if (action === 'reset') {
      void run(async () => {
        const { user: updated, oneTimePassword } = await api.updateUser(user.id, {
          resetPassword: true,
        });
        if (oneTimePassword)
          setHandover({ user: updated, password: oneTimePassword, reason: 'reset' });
      });
    } else {
      void run(() => api.deleteUser(user.id), t('users.deleted', { name: user.displayName }));
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('users.title')}</h1>
        <Button
          variant="primary"
          icon={<ICON.add />}
          disabled={busy}
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('users.new')}
        </Button>
      </div>

      {loadError && <Alert tone="error">{loadError}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert>{notice}</Alert>}
      {handover && (
        <OneTimePassword
          name={handover.user.displayName}
          username={handover.user.username}
          password={handover.password}
          reason={handover.reason}
          onDismiss={() => {
            setHandover(null);
          }}
        />
      )}
      {users && (
        <ul className="flex list-none flex-col gap-3 p-0" aria-label={t('users.list')}>
          {users.map((user) => (
            <li key={user.id}>
              <UserCard
                user={user}
                self={user.id === me?.id}
                busy={busy}
                onChange={(input, done) => void run(() => api.updateUser(user.id, input), done)}
                onConfirm={(action) => {
                  setConfirming({ user, action });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <NewUserDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={({ user, oneTimePassword }) => {
          setCreating(false);
          setError(null);
          setNotice(null);
          if (oneTimePassword) setHandover({ user, password: oneTimePassword, reason: 'created' });
          void revalidator.revalidate();
        }}
      />
      <ConfirmUserAction
        target={confirming}
        busy={busy}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={confirm}
      />
    </div>
  );
}
