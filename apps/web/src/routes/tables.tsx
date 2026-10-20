import { useState, type ReactElement } from 'react';
import { Link, useRevalidator } from 'react-router';

import type { TableView } from '@vtt/shared/api';
import { Alert, Button, Card } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { CreateTableDialog } from '../features/tables/CreateTableDialog.js';
import { t } from '../i18n/index.js';

import type { Route } from './+types/tables';

type TablesData = { tables: TableView[]; error: null } | { tables: null; error: string };

/** A failed list shows inline, so the header and "New table" stay usable. */
export async function clientLoader(): Promise<TablesData> {
  try {
    return { tables: await api.listTables(), error: null };
  } catch (error) {
    return { tables: null, error: errorMessage(error) };
  }
}

/** The tables the user belongs to, with their role in each. */
export default function TablesRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { tables, error } = loaderData;
  const revalidator = useRevalidator();
  const [creating, setCreating] = useState(false);

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
                <h2 className="text-lg font-semibold">
                  <Link to={`/tables/${table.id}`}>{table.name}</Link>
                </h2>
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
          void revalidator.revalidate();
        }}
      />
    </div>
  );
}
