import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { INVITE_ROLES, type InviteRole } from '@vtt/shared';
import type { InviteView } from '@vtt/shared/api';
import { Alert, Button, Select, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t, type MessageKey } from '../../i18n/index.js';

const DAY = 24 * 60 * 60;

/** How long a new link works; `null` never expires. */
const LIFETIMES: readonly { seconds: number | null; label: MessageKey }[] = [
  { seconds: DAY, label: 'invites.expires.day' },
  { seconds: 7 * DAY, label: 'invites.expires.week' },
  { seconds: 30 * DAY, label: 'invites.expires.month' },
  { seconds: null, label: 'invites.expires.never' },
];

const asInviteRole = (value: string): InviteRole | undefined =>
  INVITE_ROLES.find((role) => role === value);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Invite links with a role, expiry and revocation (FR-TABLE-03). GM only. */
export function InviteManager({
  tableId,
  invites,
}: {
  tableId: string;
  invites: readonly InviteView[];
}): ReactElement {
  const revalidator = useRevalidator();
  const [role, setRole] = useState<InviteRole>('player');
  const [lifetime, setLifetime] = useState(1);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setFailure(null);
    setCopied(false);
    try {
      const expiresInSeconds = LIFETIMES[lifetime]?.seconds ?? null;
      const created = await api.createInvite(tableId, { role, expiresInSeconds });
      setLink(created.url);
      await revalidator.revalidate();
    } catch (caught) {
      setFailure(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invite: InviteView) => {
    setFailure(null);
    try {
      await api.revokeInvite(tableId, invite.id);
      await revalidator.revalidate();
    } catch (caught) {
      setFailure(errorMessage(caught));
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="invites-heading">
      <h2 id="invites-heading" className="text-lg font-semibold">
        {t('invites.title')}
      </h2>
      {failure && <Alert tone="error">{failure}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t('invites.role')}
          value={role}
          onChange={(e) => {
            const next = asInviteRole(e.target.value);
            if (next) setRole(next);
          }}
        >
          {INVITE_ROLES.map((option) => (
            <option key={option} value={option}>
              {t(`tables.role.${option}`)}
            </option>
          ))}
        </Select>
        <Select
          label={t('invites.expiry')}
          value={String(lifetime)}
          onChange={(e) => {
            setLifetime(Number(e.target.value));
          }}
        >
          {LIFETIMES.map((option, index) => (
            <option key={option.label} value={String(index)}>
              {t(option.label)}
            </option>
          ))}
        </Select>
        <Button variant="primary" disabled={busy} onClick={() => void create()}>
          {t('invites.create')}
        </Button>
      </div>
      {link && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label={t('invites.link')}
            hint={t('invites.linkHint')}
            value={link}
            readOnly
            className="min-w-64 flex-1"
            onFocus={(e) => {
              e.currentTarget.select();
            }}
          />
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
              });
            }}
          >
            {t(copied ? 'invites.copied' : 'invites.copy')}
          </Button>
        </div>
      )}
      {invites.length === 0 ? (
        <p className="text-muted">{t('invites.empty')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('invites.title')}>
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{t(`tables.role.${invite.role}`)}</span>
                <span className="text-sm text-muted">
                  {t(`invites.status.${invite.status}`)} ·{' '}
                  {invite.expiresAt
                    ? t('invites.expiresAt', { date: formatDate(invite.expiresAt) })
                    : t('invites.noExpiry')}
                </span>
              </div>
              {invite.status === 'active' && (
                <Button onClick={() => void revoke(invite)}>{t('invites.revoke')}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
