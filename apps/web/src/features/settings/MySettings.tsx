import { useCallback, type ReactElement } from 'react';

import { settingsOfScope, type PluginDefinition } from '@vtt/plugin-schema';
import type { TableView } from '@vtt/shared/api';

import { api } from '../../api/endpoints.js';
import { t } from '../../i18n/index.js';
import { useTableSystem } from '../../plugin-host/system-context.js';
import type { TableModulesState } from '../../plugin-host/table-modules.js';

import { PluginSettingsForm } from './PluginSettingsForm.js';

const hasUserSettings = (definition: PluginDefinition): boolean =>
  Object.keys(settingsOfScope(definition.settings, 'user')).length > 0;

function PluginSection({
  id,
  name,
  onSaved,
}: {
  id: string;
  name: string;
  onSaved?: () => void;
}): ReactElement {
  const load = useCallback(() => api.getMyPluginSettings(id), [id]);
  const save = useCallback(
    (values: Record<string, unknown>) => api.updateMyPluginSettings(id, values),
    [id],
  );
  const label = t('settings.mineOf', { name });
  return (
    <section className="flex flex-col gap-3" aria-label={label}>
      <h3 className="font-semibold">{name}</h3>
      <PluginSettingsForm label={label} load={load} save={save} {...(onSaved && { onSaved })} />
    </section>
  );
}

export interface MySettingsProps {
  table: TableView;
  modules: TableModulesState;
  /** Called after a save, so the table's modules get the new values. */
  onSaved: () => void;
}

/** Each member's own settings of the table's system and modules (ADR-075). */
export function MySettings({ table, modules, onSaved }: MySettingsProps): ReactElement {
  const system = useTableSystem(table);
  const sections = [
    ...(system.status === 'ready' && hasUserSettings(system.system.definition)
      ? [{ id: table.systemId, name: table.systemName }]
      : []),
    ...(modules.status === 'ready'
      ? modules.modules
          .filter((module) => hasUserSettings(module.definition))
          .map((module) => ({ id: module.id, name: module.name, module: true }))
      : []),
  ];
  return (
    <section className="flex max-w-xl flex-col gap-4" aria-labelledby="my-settings-heading">
      <h2 id="my-settings-heading" className="text-lg font-semibold">
        {t('settings.mine')}
      </h2>
      {sections.length === 0 ? (
        <p className="text-muted">{t('settings.mineNone')}</p>
      ) : (
        sections.map((section) => (
          <PluginSection
            key={section.id}
            id={section.id}
            name={section.name}
            {...('module' in section && { onSaved })}
          />
        ))
      )}
    </section>
  );
}
