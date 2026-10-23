import type { Value } from '@vtt/formula';
import type { Setting } from '@vtt/plugin-schema';
import type { DataIssueReason } from '@vtt/shared/api';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Why a value does not fit a setting (specs §8.12), or `undefined` when it does. */
export function settingIssue(setting: Setting, value: unknown): DataIssueReason | undefined {
  switch (setting.type) {
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'type';
    case 'integer':
    case 'number':
      if (!isNumber(value) || (setting.type === 'integer' && !Number.isInteger(value))) {
        return 'type';
      }
      if (setting.minimum !== undefined && value < setting.minimum) return 'minimum';
      if (setting.maximum !== undefined && value > setting.maximum) return 'maximum';
      return undefined;
    case 'string':
      if (typeof value !== 'string') return 'type';
      if (setting.enum !== undefined && !setting.enum.includes(value)) return 'enum';
      if (setting.maxLength !== undefined && value.length > setting.maxLength) return 'maxLength';
      return undefined;
  }
}

/** A table setting that cannot be stored: a name the plugin does not define, or a bad value. */
export interface SettingIssue {
  name: string;
  reason: DataIssueReason | 'unknown';
}

/** Why `values` cannot be stored as a table's settings; empty when they can (FR-ADMIN-04). */
export function settingsIssues(
  definitions: Readonly<Record<string, Setting>>,
  values: Readonly<Record<string, unknown>>,
): SettingIssue[] {
  return Object.entries(values).flatMap(([name, value]): SettingIssue[] => {
    const setting = Object.hasOwn(definitions, name) ? definitions[name] : undefined;
    if (!setting) return [{ name, reason: 'unknown' }];
    const reason = settingIssue(setting, value);
    return reason ? [{ name, reason }] : [];
  });
}

/**
 * A table's setting values (specs §8.12): what the table stores where it fits the setting,
 * the default otherwise. Stored names the plugin no longer defines are dropped.
 */
export function settingValues(
  definitions: Readonly<Record<string, Setting>>,
  stored: Readonly<Record<string, unknown>> = {},
): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, setting]) => {
      const value = Object.hasOwn(stored, name) ? stored[name] : undefined;
      return [name, settingIssue(setting, value) ? setting.default : (value as Value)];
    }),
  );
}
