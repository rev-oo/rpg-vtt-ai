import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { settingValues } from '@vtt/plugin-engine';
import { canManageTable } from '@vtt/shared';
import { createTableBody, validationDetailsSchema, type TableView } from '@vtt/shared/api';
import { Alert, Button, TextField } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useTableSystem } from '../../plugin-host/system-context.js';
import { useTableData } from '../table/table-data.js';

import { ArchiveTable } from './ArchiveTable.js';
import { Compendium } from './Compendium.js';
import { houseRuleErrors, type SettingValues } from './house-rules.js';
import { HouseRules } from './HouseRules.js';
import { UpgradeSystem } from './UpgradeSystem.js';

const { name: nameSchema, description: descriptionSchema } = createTableBody.shape;

/** The table settings panel, GM only (FR-ADMIN-04, FR-TABLE-07). */
export function TableSettings(): ReactElement {
  const { table } = useTableData();
  if (!canManageTable(table.role)) return <Alert tone="error">{t('settings.gmOnly')}</Alert>;
  return (
    <div className="flex flex-col gap-8">
      <TableSettingsForm key={table.id} table={table} />
      <Compendium table={table} />
      <UpgradeSystem table={table} />
      <ArchiveTable table={table} />
    </div>
  );
}

function TableSettingsForm({ table }: { table: TableView }): ReactElement {
  const system = useTableSystem(table);
  const revalidator = useRevalidator();
  const definitions = system.status === 'ready' ? system.system.definition.settings : null;

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
  const ruleErrors = definitions ? houseRuleErrors(definitions, values) : {};
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
          <HouseRules
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
