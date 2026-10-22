import { formatJsonPath } from '@vtt/plugin-schema/issues';
import type { PluginIssueView } from '@vtt/shared/api';

import { en } from '../../i18n/en.js';
import { t, type MessageKey } from '../../i18n/index.js';

const isKey = (key: string): key is MessageKey => Object.hasOwn(en, key);

/** The catalogue key for an issue; some codes are worded by one of their parameters. */
export function issueKey(issue: Pick<PluginIssueView, 'code' | 'params'>): MessageKey {
  const variant =
    issue.code === 'invalid_value'
      ? issue.params.reason
      : issue.code === 'has_code_mismatch'
        ? issue.params.hasCode
        : undefined;
  const keys = [
    ...(variant === undefined ? [] : [`pluginIssue.${issue.code}.${String(variant)}`]),
    `pluginIssue.${issue.code}`,
  ];
  return keys.find(isKey) ?? 'pluginIssue.unknown';
}

/** A validator issue in the user's language (ADR-019), without its location. */
export function issueMessage(issue: PluginIssueView): string {
  return t(issueKey(issue), { code: issue.code, ...issue.params });
}

/** Where the issue is: `sheets/a.json $.layout.children[2]`, or just the file. */
export function issueLocation(issue: PluginIssueView): string {
  return issue.path.length > 0 ? `${issue.file} ${formatJsonPath(issue.path)}` : issue.file;
}
