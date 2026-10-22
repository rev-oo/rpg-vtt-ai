import type { ReactElement } from 'react';

import type { PluginIssueView } from '@vtt/shared/api';
import { cn } from '@vtt/ui';

import { t } from '../../i18n/index.js';

import { issueLocation, issueMessage } from './issues.js';

/** A plugin's validator issues, each with its location (ADR-019). */
export function IssueList({
  issues,
  className,
}: {
  issues: readonly PluginIssueView[];
  className?: string;
}): ReactElement {
  return (
    <ul className={cn('flex list-none flex-col gap-2 p-0', className)}>
      {issues.map((issue, index) => (
        <li key={index} className="flex flex-col gap-0.5 text-sm">
          <span className="font-mono text-xs break-all text-muted">
            <span className={issue.severity === 'error' ? 'text-danger' : ''}>
              {t(issue.severity === 'error' ? 'plugins.error' : 'plugins.warning')}
            </span>{' '}
            {issueLocation(issue)}
          </span>
          <span className="break-words">{issueMessage(issue)}</span>
        </li>
      ))}
    </ul>
  );
}
