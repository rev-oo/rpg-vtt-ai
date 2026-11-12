import type { ReactElement } from 'react';
import { Link } from 'react-router';

import type { AdminUser, UpdateUserInput } from '@vtt/shared/api';
import { Button, Card, cn } from '@vtt/ui';

import { t } from '../../i18n/index.js';
import { ICON } from '../../icons.js';

import type { UserAction } from './ConfirmUserAction.js';

export interface UserCardProps {
  user: AdminUser;
  /** The signed-in admin, who changes their own account on the Account page. */
  self: boolean;
  busy: boolean;
  /** Applies a change at once; `done` is the notice to show after it. */
  onChange: (input: UpdateUserInput, done: string) => void;
  onConfirm: (action: UserAction) => void;
}

function Badge({ className, children }: { className?: string; children: string }): ReactElement {
  return (
    <span className={cn('rounded-full bg-canvas px-2 text-sm font-semibold', className)}>
      {children}
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** One user on the users page, with what an admin may do to them (T-1619). */
export function UserCard({ user, self, busy, onChange, onConfirm }: UserCardProps): ReactElement {
  const name = user.displayName;
  return (
    <Card className={cn('flex flex-col gap-3 p-4', user.disabled && 'opacity-75')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{name}</h2>
        <span className="text-muted">@{user.username}</span>
        {self && <Badge className="bg-info-soft text-fg">{t('users.you')}</Badge>}
        {user.isAdmin && <Badge className="bg-info-soft text-fg">{t('users.admin')}</Badge>}
        {user.disabled && (
          <Badge className="bg-danger-soft text-danger">{t('users.disabled')}</Badge>
        )}
        {user.mustChangePassword && <Badge>{t('users.mustChangePassword')}</Badge>}
      </div>
      <p className="text-sm text-muted">
        {t('users.since', { date: dateFormat.format(new Date(user.createdAt)) })}
      </p>
      {self ? (
        <p className="text-sm">
          <Link to="/account">{t('users.selfHint')}</Link>
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<ICON.reset />}
            disabled={busy}
            onClick={() => {
              onConfirm('reset');
            }}
          >
            {t('users.resetPassword')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              onChange(
                { isAdmin: !user.isAdmin },
                t(user.isAdmin ? 'users.demoted' : 'users.promoted', { name }),
              );
            }}
          >
            {t(user.isAdmin ? 'users.removeAdmin' : 'users.makeAdmin')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              onChange(
                { disabled: !user.disabled },
                t(user.disabled ? 'users.enabled' : 'users.disabledNotice', { name }),
              );
            }}
          >
            {t(user.disabled ? 'users.enable' : 'users.disable')}
          </Button>
          <Button
            variant="ghost"
            icon={<ICON.delete />}
            disabled={busy}
            onClick={() => {
              onConfirm('delete');
            }}
          >
            {t('users.delete')}
          </Button>
        </div>
      )}
    </Card>
  );
}
