import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Alert, Button, Card } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import type { GameTable } from '../../api/schemas.js';
import { t } from '../../i18n/index.js';

import { CreateTableDialog } from './CreateTableDialog.js';

/** The tables the user belongs to, with their role in each. */
export function TablesPage(): ReactElement {
  const [tables, setTables] = useState<GameTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api
      .listTables()
      .then(setTables)
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      });
  }, []);

  useEffect(load, [load]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('tables.title')}</h1>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('tables.new')}
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {tables?.length === 0 && <p className="text-muted">{t('tables.empty')}</p>}
      {tables && tables.length > 0 && (
        <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4 p-0">
          {tables.map((table) => (
            <li key={table.id}>
              <Card className="flex h-full flex-col gap-2">
                <h2 className="text-lg font-semibold">{table.name}</h2>
                {table.description && <p>{table.description}</p>}
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span className="rounded-full bg-info-soft px-2 font-semibold text-fg">
                    {t(`tables.role.${table.role}`)}
                  </span>
                  <span>
                    {t('tables.system', { name: table.systemName, version: table.systemVersion })}
                  </span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CreateTableDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={() => {
          setCreating(false);
          load();
        }}
      />
    </div>
  );
}
