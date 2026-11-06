import { useEffect, useState, type ReactElement } from 'react';
import { z } from 'zod';

import { settingValues } from '@vtt/plugin-engine';
import { settingSchema, type Setting } from '@vtt/plugin-schema';
import type { PluginSettingsResponse } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

import { settingErrors, settingsTranslator, type SettingValues } from './setting-fields.js';
import { SettingFields } from './SettingFields.js';

const definitionsSchema = z.record(z.string(), settingSchema);

interface Loaded {
  definitions: Record<string, Setting>;
  translate: (text: string) => string;
  values: SettingValues;
}

function toLoaded(response: PluginSettingsResponse): Loaded {
  const definitions = definitionsSchema.parse(response.definitions);
  return {
    definitions,
    translate: settingsTranslator(response.lang, response.defaultLocale),
    values: settingValues(definitions, response.values),
  };
}

export interface PluginSettingsFormProps {
  /** Names the form for screen readers. */
  label: string;
  load: () => Promise<PluginSettingsResponse>;
  save: (values: SettingValues) => Promise<PluginSettingsResponse>;
  /** Called after a save, with the values the server kept. */
  onSaved?: () => void;
}

/** One scope of a plugin's settings, instance or user (ADR-075), loaded and saved on its own. */
export function PluginSettingsForm({
  label,
  load,
  save,
  onSaved,
}: PluginSettingsFormProps): ReactElement {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [values, setValues] = useState<SettingValues>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    load()
      .then((response) => {
        if (!live) return;
        const next = toLoaded(response);
        setLoaded(next);
        setValues(next.values);
      })
      .catch((caught: unknown) => {
        if (live) setFailure(errorMessage(caught));
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (!loaded) {
    return failure ? (
      <Alert tone="error">{failure}</Alert>
    ) : (
      <p className="text-muted">{t('app.loading')}</p>
    );
  }
  const errors = settingErrors(loaded.definitions, values);

  return (
    <form
      aria-label={label}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        setSaved(false);
        if (Object.keys(errors).length > 0) return;
        setBusy(true);
        setFailure(null);
        save(values)
          .then((response) => {
            const next = toLoaded(response);
            setLoaded(next);
            setValues(next.values);
            setSaved(true);
            onSaved?.();
          })
          .catch((caught: unknown) => {
            setFailure(errorMessage(caught));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {failure && <Alert tone="error">{failure}</Alert>}
      {saved && <Alert>{t('settings.saved')}</Alert>}
      <SettingFields
        settings={loaded.definitions}
        values={values}
        errors={submitted ? errors : {}}
        translate={loaded.translate}
        disabled={busy}
        emptyText={t('settings.noOptions')}
        onChange={(name, value) => {
          setValues((current) => ({ ...current, [name]: value }));
        }}
      />
      {Object.keys(loaded.definitions).length > 0 && (
        <Button type="submit" variant="primary" disabled={busy} className="self-start">
          {t('settings.save')}
        </Button>
      )}
    </form>
  );
}
