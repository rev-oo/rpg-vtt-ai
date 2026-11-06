import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { settingValues } from '@vtt/plugin-engine';
import { settingsOfScope } from '@vtt/plugin-schema';
import { canManageTable } from '@vtt/shared';
import { createTableBody, validationDetailsSchema, type TableView } from '@vtt/shared/api';
import { Alert, Button, TextField } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useTableSystem } from '../../plugin-host/system-context.js';
import { useLoadedModules } from '../../plugin-host/table-modules.js';
import { useTableData } from '../table/table-data.js';

import { ArchiveTable } from './ArchiveTable.js';
import { MySettings } from './MySettings.js';
import { settingErrors, type SettingValues } from './setting-fields.js';
import { SettingFields } from './SettingFields.js';
import { TableModules } from './TableModules.js';
import { UpgradeSystem } from './UpgradeSystem.js';

const { name: nameSchema, description: descriptionSchema } = createTableBody.shape;

/**
 * The table settings panel (FR-ADMIN-04, FR-TABLE-07): the table, its house rules and modules
 * for GMs, and each member's own settings of the system and modules (ADR-075).
 */
export function TableSettings(): ReactElement {
  const { table } = useTableData();
  const modules = useLoadedModules();
  const mine = <MySettings table={table} modules={modules.state} onSaved={modules.reload} />;
  if (!canManageTable(table.role)) return mine;
  return (
    <div className="flex flex-col gap-8">
      <TableSettingsForm key={table.id} table={table} />
      <TableModules key={`modules:${table.id}`} table={table} modules={modules.state} />
      {mine}
      <UpgradeSystem table={table} />
      <ArchiveTable table={table} />
    </div>
  );
}

function TableSettingsForm({ table }: { table: TableView }): ReactElement {
  const system = useTableSystem(table);
  const revalidator = useRevalidator();
  // Only the table's own settings are house rules; instance and user ones are set elsewhere.
  const definitions =
    system.status === 'ready' ? settingsOfScope(system.system.definition.settings, 'table') : null;

  const [name, setName] = useState(table.name);
  const [description, setDescription] = useState(table.description);
  const [anyActorType, setAnyActorType] = useState(table.playersMayCreateAnyActorType);
  const [rules, setRules] = useState<SettingValues | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Until edited, the house rules show the table's values, defaults filling the gaps.
  const values = rules ?? (definitions ? settingValues(definitions, table.settings) : {});
  const nameError = submitted ? nameSchema.safeParse(name).error?.issues[0]?.message : undefined;
  const descriptionError = descriptionSchema.safeParse(description).error?.issues[0]?.message;
  const ruleErrors = definitions ? settingErrors(definitions, values) : {};
  const errors = { ...ruleErrors, ...serverErrors };

  const save = async () => {
    setSubmitted(true);
    setSaved(false);
    setFailure(null);
    if (
      !nameSchema.safeParse(name).success ||
      descriptionError ||
      Object.keys(ruleErrors).length > 0
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.updateTable(table.id, {
        name: name.trim(),
        description: description.trim(),
        playersMayCreateAnyActorType: anyActorType,
        // House rules need the system that defines them (ADR-039).
        ...(definitions && { settings: values }),
      });
      await revalidator.revalidate();
      // The house rules show the saved values again, which the table now carries.
      setRules(null);
      setSaved(true);
    } catch (caught) {
      const details =
        caught instanceof ApiError && caught.code === 'validation_failed'
          ? validationDetailsSchema.safeParse(caught.details).data
          : undefined;
      const fromServer: Record<string, string> = {};
      for (const detail of details ?? []) {
        const setting = detail.path.startsWith('settings.') ? detail.path.slice(9) : null;
        if (setting) fromServer[setting] = t('settings.invalid');
      }
      setServerErrors(fromServer);
      setFailure(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex max-w-xl flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {failure && <Alert tone="error">{failure}</Alert>}
      {saved && <Alert>{t('settings.saved')}</Alert>}
      <div className="flex flex-col gap-4">
        <TextField
          label={t('createTable.name')}
          value={name}
          required
          error={nameError}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <TextField
          label={t('createTable.description')}
          value={description}
          error={descriptionError}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={anyActorType}
            onChange={(e) => {
              setAnyActorType(e.target.checked);
            }}
          />
          {t('settings.anyActorType')}
        </label>
      </div>
      <section className="flex flex-col gap-4" aria-labelledby="house-rules-heading">
        <h2 id="house-rules-heading" className="text-lg font-semibold">
          {t('settings.houseRules', { name: table.systemName })}
        </h2>
        {system.status === 'loading' && <p className="text-muted">{t('app.loading')}</p>}
        {system.status === 'unavailable' && (
          <Alert tone="info">{t('settings.houseRulesUnavailable')}</Alert>
        )}
        {system.status === 'error' && (
          <Alert tone="error">{t('table.systemFailed', { detail: system.error })}</Alert>
        )}
        {system.status === 'ready' && definitions && (
          <SettingFields
            settings={definitions}
            values={values}
            errors={submitted ? errors : serverErrors}
            translate={system.translate}
            disabled={busy}
            onChange={(setting, value) => {
              setRules({ ...values, [setting]: value });
              setServerErrors((current) =>
                Object.fromEntries(Object.entries(current).filter(([name]) => name !== setting)),
              );
            }}
          />
        )}
      </section>
      <Button type="submit" variant="primary" disabled={busy} className="self-start">
        {t('settings.save')}
      </Button>
    </form>
  );
}
