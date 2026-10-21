import type { ReactElement } from 'react';

import type { AdminPlugin } from '@vtt/shared/api';
import { Button, Card, cn } from '@vtt/ui';

import { t, type MessageKey } from '../../i18n/index.js';

import { issueLocation, issueMessage } from './issues.js';

const STATUS_CLASS: Record<AdminPlugin['status'], string> = {
  ready: 'bg-info-soft text-fg',
  invalid: 'bg-danger-soft text-danger',
  incompatible: 'bg-danger-soft text-danger',
  missing: 'bg-canvas text-muted',
};

const STATUS_HINT: Partial<Record<AdminPlugin['status'], MessageKey>> = {
  invalid: 'plugins.statusHint.invalid',
  incompatible: 'plugins.statusHint.incompatible',
  missing: 'plugins.statusHint.missing',
};

function Badge({ className, children }: { className: string; children: string }): ReactElement {
  return (
    <span className={cn('rounded-full px-2 text-sm font-semibold', className)}>{children}</span>
  );
}

export interface PluginCardProps {
  plugin: AdminPlugin;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

/** One installed plugin: status, code flag, issues, and the enable switch (FR-ADMIN-02). */
export function PluginCard({ plugin, busy, onEnable, onDisable }: PluginCardProps): ReactElement {
  const errors = plugin.issues.filter((issue) => issue.severity === 'error').length;
  const warnings = plugin.issues.length - errors;
  const hint = STATUS_HINT[plugin.status];

  return (
    <Card className="flex flex-col gap-3" aria-labelledby={`plugin-${plugin.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`plugin-${plugin.id}`} className="text-lg font-semibold break-words">
            {plugin.name}
          </h2>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted">
            <span className="font-mono">{plugin.id}</span>
            <span>{t('plugins.version', { version: plugin.version })}</span>
            {plugin.coreApi && <span>{t('plugins.coreApi', { range: plugin.coreApi })}</span>}
          </p>
        </div>
        {plugin.enabled ? (
          <Button onClick={onDisable} disabled={busy}>
            {t('plugins.disable')}
          </Button>
        ) : (
          <Button variant="primary" onClick={onEnable} disabled={busy || plugin.status !== 'ready'}>
            {t('plugins.enable')}
          </Button>
        )}
      </div>

      <p className="flex flex-wrap gap-2">
        <Badge className={STATUS_CLASS[plugin.status]}>
          {t(`plugins.status.${plugin.status}`)}
        </Badge>
        <Badge className={plugin.enabled ? 'bg-info-soft text-fg' : 'bg-canvas text-muted'}>
          {t(plugin.enabled ? 'plugins.enabled' : 'plugins.disabled')}
        </Badge>
        {plugin.hasCode && (
          <Badge className="bg-danger-soft text-danger">{t('plugins.hasCode')}</Badge>
        )}
      </p>

      {plugin.description && <p>{plugin.description}</p>}
      {hint && <p className="text-sm text-muted">{t(hint)}</p>}

      {plugin.issues.length > 0 && (
        <details open={errors > 0}>
          <summary className="cursor-pointer text-sm font-semibold">
            {t('plugins.issues', { errors, warnings })}
          </summary>
          <ul className="mt-2 flex list-none flex-col gap-2 p-0">
            {plugin.issues.map((issue, index) => (
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
        </details>
      )}
    </Card>
  );
}
