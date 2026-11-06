import { settingIssue } from '@vtt/plugin-engine';
import type { Setting } from '@vtt/plugin-schema';
import type { DataIssueReason, PluginSettingsResponse } from '@vtt/shared/api';

import { LOCALE, t } from '../../i18n/index.js';

export type SettingValues = Record<string, unknown>;

/** Why a setting's value does not fit, in the UI language (FR-ADMIN-04). */
export function settingMessage(setting: Setting, reason: DataIssueReason | 'unknown'): string {
  if (setting.type === 'integer' || setting.type === 'number') {
    if (reason === 'minimum' && setting.minimum !== undefined) {
      return t('validation.tooSmallNumber', { min: setting.minimum });
    }
    if (reason === 'maximum' && setting.maximum !== undefined) {
      return t('validation.tooBigNumber', { max: setting.maximum });
    }
    if (reason === 'type') {
      return t(setting.type === 'integer' ? 'validation.notInteger' : 'validation.notNumber');
    }
  }
  if (reason === 'maxLength' && setting.type === 'string' && setting.maxLength !== undefined) {
    return t('validation.tooLong', { max: setting.maxLength });
  }
  return t('settings.invalid');
}

/** The first problem of each value, by setting name. */
export function settingErrors(
  settings: Readonly<Record<string, Setting>>,
  values: SettingValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [name, setting] of Object.entries(settings)) {
    const reason = settingIssue(setting, values[name]);
    if (reason) errors[name] = settingMessage(setting, reason);
  }
  return errors;
}

/** The plugin's texts in the UI language, then its default one, then the text as written. */
export function settingsTranslator(
  lang: PluginSettingsResponse['lang'],
  defaultLocale: string,
): (text: string) => string {
  const langs = [lang[LOCALE], lang[defaultLocale]].filter(
    (texts): texts is Record<string, string> => texts !== undefined,
  );
  return (text) => {
    for (const texts of langs) if (Object.hasOwn(texts, text)) return texts[text] ?? text;
    return text;
  };
}
