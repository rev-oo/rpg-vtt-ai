import type { ReactElement } from 'react';

import type { AdminPlugin } from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { t } from '../../i18n/index.js';

export interface EnableCodeDialogProps {
  /** The plugin to confirm; the dialog is closed while `null`. */
  plugin: AdminPlugin | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Plugin code is trusted and runs in-process (FR-PLUGIN-06, 08), so enabling it lists the
 * code entry points and asks the admin to confirm.
 */
export function EnableCodeDialog({
  plugin,
  busy,
  onCancel,
  onConfirm,
}: EnableCodeDialogProps): ReactElement {
  return (
    <Dialog
      open={plugin !== null}
      title={t('plugins.codeTitle', { name: plugin?.name ?? '' })}
      onClose={onCancel}
    >
      {plugin && (
        <>
          <Alert tone="error">{t('plugins.codeIntro')}</Alert>
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">{t('plugins.codeEntries')}</h3>
            <ul className="list-disc pl-5 font-mono text-sm">
              {plugin.codeEntries.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {t('plugins.cancel')}
            </Button>
            <Button variant="primary" onClick={onConfirm} disabled={busy}>
              {t('plugins.codeConfirm')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
