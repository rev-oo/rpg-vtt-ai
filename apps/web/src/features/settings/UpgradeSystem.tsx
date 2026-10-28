import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { canUpgradeTableSystem } from '@vtt/shared';
import type { TableView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

import { upgradeAvailable } from './system-version.js';

/**
 * The table's system version, and the upgrade to the installed one (§9.7, ADR-058). Existing
 * sheets keep their data and say which version they were made with.
 */
export function UpgradeSystem({ table }: { table: TableView }): ReactElement {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = upgradeAvailable(table) && canUpgradeTableSystem(table.role);

  const upgrade = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.upgradeTableSystem(table.id);
      await revalidator.revalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="system-version-heading">
      <h2 id="system-version-heading" className="text-lg font-semibold">
        {t('systemVersion.title')}
      </h2>
      <p className="text-muted">
        {t('systemVersion.current', { name: table.systemName, version: table.systemVersion })}
      </p>
      {available && (
        <>
          <p>{t('systemVersion.help', { version: table.installedVersion ?? '' })}</p>
          {error && <Alert tone="error">{error}</Alert>}
          <div>
            <Button
              variant="secondary"
              disabled={busy || table.archivedAt !== null}
              onClick={() => void upgrade()}
            >
              {t('systemVersion.upgrade', { version: table.installedVersion ?? '' })}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
