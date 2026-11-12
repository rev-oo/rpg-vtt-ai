import { useEffect, useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { settingValues } from '@vtt/plugin-engine';
import { settingsOfScope } from '@vtt/plugin-schema';
import type { ModuleSummary, TableView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import type { TableModulesState } from '../../plugin-host/table-modules.js';

import { settingErrors, type SettingValues } from './setting-fields.js';
import { SettingFields } from './SettingFields.js';

export interface TableModulesProps {
  table: TableView;
  modules: TableModulesState;
}

/** Which modules the table uses, and their table settings; GM only (ADR-075). */
export function TableModules({ table, modules }: TableModulesProps): ReactElement {
  const revalidator = useRevalidator();
  const [available, setAvailable] = useState<ModuleSummary[] | null>(null);
  const [chosen, setChosen] = useState<string[]>(table.modules);
  const [edits, setEdits] = useState<Record<string, SettingValues>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .listModules()
      .then((list) => {
        if (live) setAvailable(list);
      })
      .catch((caught: unknown) => {
        if (live) setFailure(errorMessage(caught));
      });
    return () => {
      live = false;
    };
  }, []);

  // The table settings of chosen modules that have loaded, as edited or as stored.
  const forms = (modules.status === 'ready' ? modules.modules : [])
    .filter((module) => chosen.includes(module.id))
    .map((module) => {
      const definitions = settingsOfScope(module.definition.settings, 'table');
      const values =
        edits[module.id] ?? settingValues(definitions, table.moduleSettings[module.id] ?? {});
      return { module, definitions, values, errors: settingErrors(definitions, values) };
    })
    .filter((form) => Object.keys(form.definitions).length > 0);

  const save = () => {
    setSubmitted(true);
    setSaved(false);
    setFailure(null);
    if (forms.some((form) => Object.keys(form.errors).length > 0)) return;
    setBusy(true);
    api
      .updateTable(table.id, {
        modules: chosen,
        moduleSettings: {
          ...Object.fromEntries(
            Object.entries(table.moduleSettings).filter(([id]) => chosen.includes(id)),
          ),
          ...Object.fromEntries(forms.map((form) => [form.module.id, form.values])),
        },
      })
      .then(async () => {
        await revalidator.revalidate();
        setEdits({});
        setSubmitted(false);
        setSaved(true);
      })
      .catch((caught: unknown) => {
        setFailure(errorMessage(caught));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  // Modules the table uses that are no longer enabled stay listed, so the GM can remove them.
  const listed = [
    ...(available ?? []),
    ...chosen
      .filter((id) => !available?.some((module) => module.id === id))
      .map((id) => ({ id, name: id, version: '', description: null, missing: true })),
  ];

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      aria-labelledby="table-modules-heading"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h2 id="table-modules-heading" className="text-lg font-semibold">
        {t('settings.modules')}
      </h2>
      <p className="text-sm text-muted">{t('settings.modulesHint')}</p>
      {failure && <Alert tone="error">{failure}</Alert>}
      {saved && <Alert>{t('settings.saved')}</Alert>}
      {available === null && !failure && <p className="text-muted">{t('app.loading')}</p>}
      {available !== null && listed.length === 0 && (
        <p className="text-muted">{t('settings.noModules')}</p>
      )}
      {listed.length > 0 && (
        <ul className="flex flex-col gap-2">
          {listed.map((module) => (
            <li key={module.id}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={chosen.includes(module.id)}
                  disabled={busy}
                  onChange={(e) => {
                    setSaved(false);
                    setChosen((current) =>
                      e.target.checked
                        ? [...current, module.id]
                        : current.filter((id) => id !== module.id),
                    );
                  }}
                />
                <span className="flex flex-col">
                  <span className="font-semibold">{module.name}</span>
                  {'missing' in module ? (
                    <span className="text-sm text-muted">{t('settings.moduleMissing')}</span>
                  ) : (
                    module.description && (
                      <span className="text-sm text-muted">{module.description}</span>
                    )
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {forms.map((form) => (
        <section
          key={form.module.id}
          className="flex flex-col gap-3"
          aria-label={t('settings.moduleSettings', { name: form.module.name })}
        >
          <h3 className="font-semibold">
            {t('settings.moduleSettings', { name: form.module.name })}
          </h3>
          <SettingFields
            settings={form.definitions}
            values={form.values}
            errors={submitted ? form.errors : {}}
            translate={form.module.translate}
            disabled={busy}
            onChange={(name, value) => {
              setSaved(false);
              setEdits((current) => ({
                ...current,
                [form.module.id]: { ...form.values, [name]: value },
              }));
            }}
          />
        </section>
      ))}
      {/* Nothing to choose, nothing to save (T-1620). */}
      {listed.length > 0 && (
        <Button type="submit" variant="primary" disabled={busy} className="self-start">
          {t('settings.saveModules')}
        </Button>
      )}
    </form>
  );
}
