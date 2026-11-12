import { useState, type ReactElement } from 'react';

import { Button, Card, TextField } from '@vtt/ui';

import { t } from '../../i18n/index.js';
import { ICON } from '../../icons.js';

export interface OneTimePasswordProps {
  name: string;
  username: string;
  password: string;
  reason: 'created' | 'reset';
  onDismiss: () => void;
}

/**
 * A one-time password to hand over. The server returns it once, so it stays on the page until
 * the admin dismisses it (T-1619).
 */
export function OneTimePassword({
  name,
  username,
  password,
  reason,
  onDismiss,
}: OneTimePasswordProps): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="flex flex-col gap-3 border-primary" role="status">
      <h2 className="text-lg font-semibold">
        {t(reason === 'created' ? 'users.createdTitle' : 'users.resetTitle', { name })}
      </h2>
      <p>{t('users.handover', { username })}</p>
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          label={t('users.oneTimePassword')}
          value={password}
          readOnly
          className="min-w-64 flex-1 font-mono"
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
        <Button
          icon={<ICON.copy />}
          onClick={() => {
            void navigator.clipboard.writeText(password).then(() => {
              setCopied(true);
            });
          }}
        >
          {t(copied ? 'users.copied' : 'users.copy')}
        </Button>
        <Button variant="ghost" onClick={onDismiss}>
          {t('users.done')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('users.shownOnce')}</p>
    </Card>
  );
}
