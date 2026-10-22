import { useState, type ReactElement } from 'react';
import { redirect, useRevalidator } from 'react-router';

import type { AdminPlugin } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { EnableCodeDialog } from '../features/plugins/EnableCodeDialog.js';
import { PluginCard } from '../features/plugins/PluginCard.js';
import { t } from '../i18n/index.js';
import { adminRedirect } from '../shell/access.js';
import { loadSession } from '../shell/session.js';

import type { Route } from './+types/admin-plugins';

type PluginsData = { plugins: AdminPlugin[]; error: null } | { plugins: null; error: string };

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<PluginsData | Response> {
  const to = adminRedirect(await loadSession(), new URL(request.url));
  if (to) return redirect(to);
  try {
    return { plugins: await api.listPlugins(), error: null };
  } catch (error) {
    return { plugins: null, error: errorMessage(error) };
  }
}

/** The plugin admin page: list, rescan, enable and disable (FR-ADMIN-02). */
export default function AdminPluginsRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { plugins, error: loadError } = loaderData;
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminPlugin | null>(null);

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await revalidator.revalidate();
      if (done) setNotice(done);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const enable = (plugin: AdminPlugin) => {
    if (plugin.hasCode) setConfirming(plugin);
    else void run(() => api.enablePlugin(plugin.id));
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('plugins.title')}</h1>
        <Button
          onClick={() => void run(() => api.rescanPlugins(), t('plugins.rescanned'))}
          disabled={busy}
        >
          {t('plugins.rescan')}
        </Button>
      </div>

      {loadError && <Alert tone="error">{loadError}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert>{notice}</Alert>}
      {plugins?.length === 0 && <p className="text-muted">{t('plugins.empty')}</p>}
      {plugins && plugins.length > 0 && (
        <ul className="flex list-none flex-col gap-4 p-0">
          {plugins.map((plugin) => (
            <li key={plugin.id}>
              <PluginCard
                plugin={plugin}
                busy={busy}
                onEnable={() => {
                  enable(plugin);
                }}
                onDisable={() => void run(() => api.disablePlugin(plugin.id))}
              />
            </li>
          ))}
        </ul>
      )}

      <EnableCodeDialog
        plugin={confirming}
        busy={busy}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          const plugin = confirming;
          setConfirming(null);
          if (plugin) void run(() => api.enablePlugin(plugin.id, true));
        }}
      />
    </div>
  );
}
