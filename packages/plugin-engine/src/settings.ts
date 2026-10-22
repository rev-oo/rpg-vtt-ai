import type { Value } from '@vtt/formula';
import type { Setting } from '@vtt/plugin-schema';

function fits(setting: Setting, value: unknown): boolean {
  switch (setting.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (setting.type === 'number' || Number.isInteger(value)) &&
        (setting.minimum === undefined || value >= setting.minimum) &&
        (setting.maximum === undefined || value <= setting.maximum)
      );
    case 'string':
      return (
        typeof value === 'string' &&
        (setting.enum === undefined || setting.enum.includes(value)) &&
        (setting.maxLength === undefined || value.length <= setting.maxLength)
      );
  }
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
      return [name, fits(setting, value) ? (value as Value) : setting.default];
    }),
  );
}
