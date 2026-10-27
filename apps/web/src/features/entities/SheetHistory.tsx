import { useState, type ReactElement } from 'react';

import type { ActorSnapshot } from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Sheet history (FR-SHEET-11, ADR-053): the actor's snapshots, newest first, each of which
 * can be restored. Restoring changes the live sheet, so it shows here and for everyone.
 */
export function SheetHistory({ actorId }: { actorId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ActorSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setSnapshots(await api.actorHistory(actorId));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const restore = async (snapshot: ActorSnapshot) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.restoreSnapshot(actorId, snapshot.id);
      setNotice(t('history.restored', { time: when(snapshot.createdAt) }));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
          setSnapshots(null);
          setError(null);
          setNotice(null);
          void load();
        }}
      >
        {t('history.open')}
      </Button>
      <Dialog
        open={open}
        title={t('history.title')}
        onClose={() => {
          setOpen(false);
        }}
      >
        <p className="text-sm text-muted">{t('history.help')}</p>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {snapshots === null && !error && <p className="text-muted">{t('app.loading')}</p>}
        {snapshots?.length === 0 && <p className="text-muted">{t('history.empty')}</p>}
        {snapshots && snapshots.length > 0 && (
          <ul className="flex max-h-80 list-none flex-col gap-1 overflow-y-auto p-0">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="flex items-center justify-between gap-2">
                <span>
                  {when(snapshot.createdAt)}
                  {snapshot.layer === 'secret' && (
                    <span className="ml-2 rounded-full bg-info-soft px-2 text-xs">
                      {t('history.secret')}
                    </span>
                  )}
                </span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-label={t('history.restoreAt', { time: when(snapshot.createdAt) })}
                  onClick={() => void restore(snapshot)}
                >
                  {t('history.restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t('history.close')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
