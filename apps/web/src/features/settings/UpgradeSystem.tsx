import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { canUpgradeTableSystem } from '@vtt/shared';
import type { MigrationFailure, MigrationReport, TableView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

import { upgradeAvailable } from './system-version.js';

/** Why an actor or item was not migrated, in the reader's language. */
function failureReason(failure: MigrationFailure): string {
  switch (failure.reason) {
    case 'step':
      return t('migrationFailure.step', {
        step: (failure.step ?? 0) + 1,
        version: failure.version ?? '',
      });
    case 'invalid':
      return t('migrationFailure.invalid', {
        fields: (failure.issues ?? []).map((issue) => issue.path.join('.')).join(', '),
      });
    case 'hook':
      return t('migrationFailure.hook');
    case 'code':
      return t('migrationFailure.code');
  }
}

function Report({ report }: { report: MigrationReport }): ReactElement {
  const more = report.failedCount - report.failed.length;
  return (
    <div className="flex flex-col gap-2" role="status">
      <p>{t('systemVersion.migrated', { count: report.migrated })}</p>
      {report.failedCount > 0 && (
        <Alert tone="error">
          <p>{t('systemVersion.failed', { count: report.failedCount })}</p>
          <ul className="list-disc pl-5">
            {report.failed.map((failure) => (
              <li key={`${failure.kind}:${failure.id}`}>
                <span className="font-medium">{failure.name}</span>: {failureReason(failure)}
              </li>
            ))}
          </ul>
          {more > 0 && <p>{t('systemVersion.failedMore', { count: more })}</p>}
        </Alert>
      )}
    </div>
  );
}

/**
 * The table's system version, and the upgrade to the installed one (§9.7, ADR-058). Upgrading
 * migrates the table's actors and items; those left behind can be migrated again (ADR-072).
 */
export function UpgradeSystem({ table }: { table: TableView }): ReactElement {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const allowed = canUpgradeTableSystem(table.role);
  const available = upgradeAvailable(table) && allowed;
  const outdated = allowed && !available && table.outdatedEntities > 0;

  const upgrade = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport((await api.upgradeTableSystem(table.id)).migration);
      await revalidator.revalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || table.archivedAt !== null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="system-version-heading">
      <h2 id="system-version-heading" className="text-lg font-semibold">
        {t('systemVersion.title')}
      </h2>
      <p className="text-muted">
        {t('systemVersion.current', { name: table.systemName, version: table.systemVersion })}
      </p>
      {report && <Report report={report} />}
      {error && <Alert tone="error">{error}</Alert>}
      {available && (
        <>
          <p>{t('systemVersion.help', { version: table.installedVersion ?? '' })}</p>
          <div>
            <Button variant="secondary" disabled={disabled} onClick={() => void upgrade()}>
              {t('systemVersion.upgrade', { version: table.installedVersion ?? '' })}
            </Button>
          </div>
        </>
      )}
      {outdated && (
        <>
          <p>{t('systemVersion.outdated', { count: table.outdatedEntities })}</p>
          <div>
            <Button variant="secondary" disabled={disabled} onClick={() => void upgrade()}>
              {t('systemVersion.migrateAgain')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
