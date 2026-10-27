import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { createRules, type Rules } from '@vtt/plugin-engine';
import type { TableView } from '@vtt/shared/api';

import { errorMessage } from '../api/errors.js';
import { LOCALE } from '../i18n/index.js';

import { loadSystem, systemTranslator, type LoadedSystem } from './load.js';

/** The table's system plugin as the page sees it. */
export type TableSystem =
  | { status: 'loading' }
  /** Disabled, missing or broken: the table is read-only (FR-PLUGIN-03). */
  | { status: 'unavailable' }
  | { status: 'error'; error: string }
  | {
      status: 'ready';
      system: LoadedSystem;
      rules: Rules;
      translate: (text: string) => string;
    };

/** Loads a table's system plugin while the table page is open (T-0409). */
export function useTableSystem(table: TableView): TableSystem {
  const [state, setState] = useState<
    { key: string; system: LoadedSystem } | { key: string; error: string } | null
  >(null);
  const key = `${table.systemId}@${table.systemVersion}`;

  useEffect(() => {
    if (!table.systemAvailable) return;
    let current = true;
    loadSystem(table.systemId, table.systemVersion).then(
      (system) => {
        if (current) setState({ key, system });
      },
      (error: unknown) => {
        if (current) setState({ key, error: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [key, table.systemAvailable, table.systemId, table.systemVersion]);

  return useMemo((): TableSystem => {
    if (!table.systemAvailable) return { status: 'unavailable' };
    if (state?.key !== key) return { status: 'loading' };
    if ('error' in state) return { status: 'error', error: state.error };
    const { definition, functions } = state.system;
    return {
      status: 'ready',
      system: state.system,
      rules: createRules(definition, { settings: table.settings, functions }),
      translate: systemTranslator(definition, LOCALE),
    };
  }, [state, key, table.systemAvailable, table.settings]);
}

export const TableSystemContext = createContext<TableSystem>({ status: 'loading' });

export const useSystem = (): TableSystem => useContext(TableSystemContext);
