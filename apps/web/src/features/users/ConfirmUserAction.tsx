import type { ReactElement } from 'react';

import type { AdminUser } from '@vtt/shared/api';
import { Button, Dialog } from '@vtt/ui';

import { t } from '../../i18n/index.js';

/** The user actions that ask first: they sign the user out, or cannot be undone. */
export type UserAction = 'reset' | 'delete';

export interface ConfirmUserActionProps {
  /** The user and action to confirm; the dialog is closed while `null`. */
  target: { user: AdminUser; action: UserAction } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (user: AdminUser, action: UserAction) => void;
}

export function ConfirmUserAction({
  target,
  busy,
  onCancel,
  onConfirm,
}: ConfirmUserActionProps): ReactElement {
  const name = target?.user.displayName ?? '';
  const reset = target?.action === 'reset';
  return (
    <Dialog
      open={target !== null}
      title={t(reset ? 'users.resetConfirmTitle' : 'users.deleteConfirmTitle', { name })}
      onClose={onCancel}
    >
      {target && (
        <>
          <p>{t(reset ? 'users.resetConfirm' : 'users.deleteConfirm', { name })}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={onCancel} disabled={busy}>
              {t('users.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                onConfirm(target.user, target.action);
              }}
            >
              {t(reset ? 'users.resetPassword' : 'users.delete')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
