import { settingIssue } from '@vtt/plugin-engine';
import type { Setting } from '@vtt/plugin-schema';
import type { DataIssueReason } from '@vtt/shared/api';

import { t } from '../../i18n/index.js';

export type SettingValues = Record<string, unknown>;

/** Why a house-rule value does not fit, in the UI language (FR-ADMIN-04). */
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
export function houseRuleErrors(
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
