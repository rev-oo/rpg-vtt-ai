import type { ReactElement } from 'react';

import type { Setting } from '@vtt/plugin-schema';
import { Select, TextField } from '@vtt/ui';

import { t } from '../../i18n/index.js';

import type { SettingValues } from './house-rules.js';

/** Number inputs hold text while typing; an empty or unparsable one stays text. */
function parseNumber(text: string): number | string {
  const value = Number(text);
  return text.trim() === '' || !Number.isFinite(value) ? text : value;
}

export interface HouseRulesProps {
  settings: Readonly<Record<string, Setting>>;
  values: SettingValues;
  errors: Readonly<Record<string, string>>;
  /** Translates the plugin's label keys. */
  translate: (text: string) => string;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}

/** One input per option of the system's `settings.json` (specs §8.12). */
export function HouseRules({
  settings,
  values,
  errors,
  translate,
  onChange,
  disabled,
}: HouseRulesProps): ReactElement {
  const entries = Object.entries(settings);
  if (entries.length === 0) return <p className="text-muted">{t('settings.noHouseRules')}</p>;

  return (
    <div className="flex flex-col gap-4">
      {entries.map(([name, setting]) => {
        const label = translate(setting.label);
        const hint = setting.description && translate(setting.description);
        const value = values[name];
        switch (setting.type) {
          case 'boolean':
            return (
              <label key={name} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    name={name}
                    checked={value === true}
                    disabled={disabled}
                    onChange={(e) => {
                      onChange(name, e.target.checked);
                    }}
                  />
                  {label}
                </span>
                {hint && <span className="text-sm text-muted">{hint}</span>}
              </label>
            );
          case 'integer':
          case 'number':
            return (
              <TextField
                key={name}
                name={name}
                type="number"
                label={label}
                {...(hint && { hint })}
                error={errors[name]}
                disabled={disabled}
                {...(setting.minimum !== undefined && { min: setting.minimum })}
                {...(setting.maximum !== undefined && { max: setting.maximum })}
                step={setting.type === 'integer' ? 1 : 'any'}
                value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                onChange={(e) => {
                  onChange(name, parseNumber(e.target.value));
                }}
              />
            );
          case 'string':
            return setting.enum ? (
              <Select
                key={name}
                name={name}
                label={label}
                disabled={disabled}
                value={typeof value === 'string' ? value : setting.default}
                onChange={(e) => {
                  onChange(name, e.target.value);
                }}
              >
                {setting.enum.map((option) => (
                  <option key={option} value={option}>
                    {translate(option)}
                  </option>
                ))}
              </Select>
            ) : (
              <TextField
                key={name}
                name={name}
                label={label}
                {...(hint && { hint })}
                error={errors[name]}
                disabled={disabled}
                {...(setting.maxLength !== undefined && { maxLength: setting.maxLength })}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => {
                  onChange(name, e.target.value);
                }}
              />
            );
        }
      })}
    </div>
  );
}
