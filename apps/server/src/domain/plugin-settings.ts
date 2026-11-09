import { settingsIssues, type SettingIssue } from '@vtt/plugin-engine';
import { settingsOfScope, type PluginDefinition, type SettingScope } from '@vtt/plugin-schema';
import type { PluginSettingsResponse } from '@vtt/shared/api';

import { badRequest } from '../errors.js';

// Plugin settings by scope (ADR-075): instance values on the plugin's row, table values on
// the table, user values in `user_plugin_settings`. Each scope is checked against the
// settings `settings.json` declares for it.

function settingMessage({ reason }: SettingIssue): string {
  switch (reason) {
    case 'unknown':
      return 'The plugin has no such setting.';
    case 'type':
      return 'This value does not fit the setting.';
    case 'enum':
      return 'Must be one of the listed options.';
    case 'minimum':
      return 'Too small.';
    case 'maximum':
      return 'Too large.';
    case 'minLength':
    case 'maxLength':
      return 'Wrong length.';
    case 'format':
      return 'Not in the expected format.';
  }
}

/**
 * Refuses values for settings the plugin does not declare in `scope`, and values that do not
 * fit them (specs §8.12). Problems are reported under `<prefix>.<name>`.
 */
export function checkSettingValues(
  definition: PluginDefinition | undefined,
  scope: SettingScope,
  values: Readonly<Record<string, unknown>>,
  prefix: string,
): void {
  const issues = settingsIssues(settingsOfScope(definition?.settings ?? {}, scope), values);
  if (issues.length === 0) return;
  throw badRequest(
    'validation_failed',
    'The request is invalid.',
    issues.map((issue) => ({
      path: `${prefix}.${issue.name}`,
      reason: issue.reason,
      message: settingMessage(issue),
    })),
  );
}

/** One scope of a plugin's settings, with the texts its form needs. */
export function settingsResponse(
  definition: PluginDefinition,
  scope: SettingScope,
  values: Record<string, unknown>,
): PluginSettingsResponse {
  const { manifest } = definition;
  return {
    definitions: settingsOfScope(definition.settings, scope),
    lang: definition.lang,
    defaultLocale: manifest.defaultLocale ?? manifest.locales?.[0] ?? 'en',
    values,
  };
}
