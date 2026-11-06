import { createContext, use, useCallback, useEffect, useState } from 'react';

import type { Value } from '@vtt/formula';
import { pluginDefinitionSchema, type PluginDefinition } from '@vtt/plugin-schema';
import type { TableView } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { LOCALE } from '../i18n/index.js';

import { systemTranslator } from './load.js';

// A table's module plugins (T-1601, ADR-075), as its members load them with the table, and
// their look on the table page: themes and named-part styles (T-1602, ADR-076).

export interface LoadedModule {
  id: string;
  name: string;
  version: string;
  definition: PluginDefinition;
  translate: (text: string) => string;
  /** Every setting's value for this viewer: instance, table or user, by its scope. */
  settings: Readonly<Record<string, Value>>;
  /** URLs of its scoped stylesheets and of `code/client.js`. */
  styles: readonly string[];
  client: string | null;
}

export type TableModulesState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; modules: LoadedModule[] };

/** Loads the table's available modules again whenever the table's choice or settings change. */
export function useTableModules(table: TableView): {
  state: TableModulesState;
  reload: () => void;
} {
  const [state, setState] = useState<TableModulesState>({ status: 'loading' });
  const [round, setRound] = useState(0);
  const key = JSON.stringify([table.id, table.modules, table.moduleSettings]);

  useEffect(() => {
    let live = true;
    const [tableId] = JSON.parse(key) as [string];
    api
      .getTableModules(tableId)
      .then((modules) => {
        if (!live) return;
        setState({
          status: 'ready',
          modules: modules.map((module) => {
            const definition = pluginDefinitionSchema.parse(module.definition);
            return {
              id: module.id,
              name: module.name,
              version: module.version,
              definition,
              translate: systemTranslator(definition, LOCALE),
              settings: module.settings as Record<string, Value>,
              styles: module.styles,
              client: module.client,
            };
          }),
        });
      })
      .catch((caught: unknown) => {
        if (live) setState({ status: 'error', error: errorMessage(caught) });
      });
    return () => {
      live = false;
    };
  }, [key, round]);

  const reload = useCallback(() => {
    setRound((current) => current + 1);
  }, []);
  return { state, reload };
}

export interface TableModules {
  state: TableModulesState;
  /** Loads them again, as after the viewer changed their own settings. */
  reload: () => void;
}

/** The table page's modules, loaded once by the page. */
export const TableModulesContext = createContext<TableModules | null>(null);

export function useLoadedModules(): TableModules {
  const modules = use(TableModulesContext);
  if (!modules) throw new Error('useLoadedModules used outside a table page');
  return modules;
}

/** The attribute on `<html>` that module styles match: the ids of the modules that are on. */
export const MODULES_ATTRIBUTE = 'data-vtt-modules';

/**
 * Puts the modules' look on the page while it shows them (ADR-076): their ids on `<html>`, which
 * their themes and stylesheets are scoped to, and links to those stylesheets. Both go when the
 * table page closes or a module leaves the table.
 */
export function useModuleLook(state: TableModulesState): void {
  const key =
    state.status === 'ready'
      ? JSON.stringify(
          state.modules.map((module) => [
            module.id,
            module.styles.map((url) => `${url}?v=${encodeURIComponent(module.version)}`),
          ]),
        )
      : '[]';
  useEffect(() => {
    const modules = JSON.parse(key) as [string, string[]][];
    if (modules.length === 0) return;
    const root = document.documentElement;
    root.setAttribute(MODULES_ATTRIBUTE, modules.map(([id]) => id).join(' '));
    const links = modules.flatMap(([id, urls]) =>
      urls.map((url) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.dataset.moduleStyle = id;
        document.head.append(link);
        return link;
      }),
    );
    return () => {
      root.removeAttribute(MODULES_ATTRIBUTE);
      for (const link of links) link.remove();
    };
  }, [key]);
}
