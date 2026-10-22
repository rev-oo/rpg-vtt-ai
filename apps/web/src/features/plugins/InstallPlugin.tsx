import { useRef, useState, type ReactElement } from 'react';

import {
  invalidPluginDetailsSchema,
  type AdminPlugin,
  type PluginIssueView,
} from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

import { IssueList } from './IssueList.js';

export interface InstallPluginProps {
  busy: boolean;
  onBusy: (busy: boolean) => void;
  /** After an install, with the plugin as the server lists it now. */
  onInstalled: (plugin: AdminPlugin) => void;
}

/**
 * Installs a `.vttplugin` archive from `vtt-plugin pack` (ADR-026). A plugin that is already
 * installed is only replaced after the admin confirms; a plugin with errors lists them.
 */
export function InstallPlugin({ busy, onBusy, onInstalled }: InstallPluginProps): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<PluginIssueView[]>([]);

  const install = async (file: File, replace: boolean) => {
    onBusy(true);
    setError(null);
    setIssues([]);
    try {
      onInstalled(await api.installPlugin(file, replace));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'plugin_exists') {
        setPending(file);
        return;
      }
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.code === 'invalid_plugin') {
        setIssues(invalidPluginDetailsSchema.safeParse(cause.details).data?.issues ?? []);
      }
    } finally {
      onBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".vttplugin,.zip,application/zip"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('plugins.installFile')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void install(file, false);
        }}
      />
      <Button
        disabled={busy}
        onClick={() => {
          input.current?.click();
        }}
      >
        {t('plugins.install')}
      </Button>
      {error && (
        <div className="basis-full">
          <Alert tone="error">
            {error}
            {issues.length > 0 && <IssueList issues={issues} className="mt-2" />}
          </Alert>
        </div>
      )}
      <Dialog
        open={pending !== null}
        title={t('plugins.replaceTitle')}
        onClose={() => {
          setPending(null);
        }}
      >
        <p>{t('plugins.replaceIntro', { file: pending?.name ?? '' })}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPending(null);
            }}
          >
            {t('plugins.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              const file = pending;
              setPending(null);
              if (file) void install(file, true);
            }}
          >
            {t('plugins.replace')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
