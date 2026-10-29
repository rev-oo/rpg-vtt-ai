import { useState, type ReactElement } from 'react';
import { redirect, useRevalidator } from 'react-router';

import {
  instanceSettingsSchema,
  MAX_ASSET_QUOTA_BYTES,
  MAX_SESSION_LIFETIME_SECONDS,
  MAX_UPLOAD_BYTES,
  MIB,
  MIN_ASSET_QUOTA_BYTES,
  MIN_UPLOAD_BYTES,
  MIN_SESSION_LIFETIME_SECONDS,
  REGISTRATION_POLICIES,
  type InstanceSettings,
  type RegistrationPolicy,
} from '@vtt/shared/api';
import { Alert, Button, Select, TextField } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { t } from '../i18n/index.js';
import { adminRedirect } from '../shell/access.js';
import { refreshInstanceInfo } from '../shell/instance.js';
import { loadSession } from '../shell/session.js';

import type { Route } from './+types/admin-settings';

type SettingsData = { settings: InstanceSettings; error: null } | { settings: null; error: string };

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<SettingsData | Response> {
  const to = adminRedirect(await loadSession(), new URL(request.url));
  if (to) return redirect(to);
  try {
    return { settings: await api.getInstanceSettings(), error: null };
  } catch (error) {
    return { settings: null, error: errorMessage(error) };
  }
}

const HOUR = 60 * 60;
const asPolicy = (value: string): RegistrationPolicy | undefined =>
  REGISTRATION_POLICIES.find((policy) => policy === value);

/** Instance settings, for admins (FR-ADMIN-01). */
export default function AdminSettingsRoute({ loaderData }: Route.ComponentProps): ReactElement {
  if (!loaderData.settings) return <Alert tone="error">{loaderData.error}</Alert>;
  return <SettingsForm initial={loaderData.settings} />;
}

function SettingsForm({ initial }: { initial: InstanceSettings }): ReactElement {
  const [siteName, setSiteName] = useState(initial.siteName);
  const [registration, setRegistration] = useState(initial.registration);
  // Edited in hours; stored in seconds.
  const [hours, setHours] = useState(String(initial.sessionLifetimeSeconds / HOUR));
  // Upload limits are edited in MiB; stored in bytes (ADR-064).
  const [uploadMib, setUploadMib] = useState(String(initial.maxUploadBytes / MIB));
  const [quotaMib, setQuotaMib] = useState(String(initial.assetQuotaBytes / MIB));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const revalidator = useRevalidator();

  const shape = instanceSettingsSchema.shape;
  const siteNameError = shape.siteName.safeParse(siteName).error?.issues[0]?.message;
  const lifetime = Number(hours) * HOUR;
  const lifetimeValid =
    hours.trim() !== '' && shape.sessionLifetimeSeconds.safeParse(lifetime).success;
  const uploadBytes = Number(uploadMib) * MIB;
  const uploadValid =
    uploadMib.trim() !== '' && shape.maxUploadBytes.safeParse(uploadBytes).success;
  const quotaBytes = Number(quotaMib) * MIB;
  const quotaValid = quotaMib.trim() !== '' && shape.assetQuotaBytes.safeParse(quotaBytes).success;

  const save = async () => {
    setSubmitted(true);
    setSaved(false);
    setFailure(null);
    if (siteNameError || !lifetimeValid || !uploadValid || !quotaValid) return;
    setBusy(true);
    try {
      await api.updateInstanceSettings({
        siteName: siteName.trim(),
        registration,
        sessionLifetimeSeconds: lifetime,
        maxUploadBytes: uploadBytes,
        assetQuotaBytes: quotaBytes,
      });
      // The header shows the new site name.
      refreshInstanceInfo();
      await revalidator.revalidate();
      setSaved(true);
    } catch (caught) {
      setFailure(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mx-auto flex max-w-xl flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1 className="text-2xl font-bold">{t('instance.title')}</h1>
      {failure && <Alert tone="error">{failure}</Alert>}
      {saved && <Alert>{t('instance.saved')}</Alert>}
      <TextField
        label={t('instance.siteName')}
        value={siteName}
        required
        error={submitted ? siteNameError : undefined}
        onChange={(e) => {
          setSiteName(e.target.value);
        }}
      />
      <Select
        label={t('instance.registration')}
        value={registration}
        onChange={(e) => {
          const policy = asPolicy(e.target.value);
          if (policy) setRegistration(policy);
        }}
      >
        {REGISTRATION_POLICIES.map((policy) => (
          <option key={policy} value={policy}>
            {t(`instance.registration.${policy}`)}
          </option>
        ))}
      </Select>
      <TextField
        label={t('instance.sessionLifetime')}
        hint={t('instance.sessionLifetimeHint')}
        type="number"
        min={MIN_SESSION_LIFETIME_SECONDS / HOUR}
        max={MAX_SESSION_LIFETIME_SECONDS / HOUR}
        step={1}
        value={hours}
        error={
          submitted && !lifetimeValid
            ? t('instance.sessionLifetimeRange', {
                min: MIN_SESSION_LIFETIME_SECONDS / HOUR,
                max: MAX_SESSION_LIFETIME_SECONDS / HOUR,
              })
            : undefined
        }
        onChange={(e) => {
          setHours(e.target.value);
        }}
      />
      <TextField
        label={t('instance.maxUpload')}
        hint={t('instance.maxUploadHint')}
        type="number"
        min={MIN_UPLOAD_BYTES / MIB}
        max={MAX_UPLOAD_BYTES / MIB}
        step={1}
        value={uploadMib}
        error={
          submitted && !uploadValid
            ? t('instance.mibRange', { min: MIN_UPLOAD_BYTES / MIB, max: MAX_UPLOAD_BYTES / MIB })
            : undefined
        }
        onChange={(e) => {
          setUploadMib(e.target.value);
        }}
      />
      <TextField
        label={t('instance.assetQuota')}
        hint={t('instance.assetQuotaHint')}
        type="number"
        min={MIN_ASSET_QUOTA_BYTES / MIB}
        max={MAX_ASSET_QUOTA_BYTES / MIB}
        step={1}
        value={quotaMib}
        error={
          submitted && !quotaValid
            ? t('instance.mibRange', {
                min: MIN_ASSET_QUOTA_BYTES / MIB,
                max: MAX_ASSET_QUOTA_BYTES / MIB,
              })
            : undefined
        }
        onChange={(e) => {
          setQuotaMib(e.target.value);
        }}
      />
      <Button type="submit" variant="primary" disabled={busy} className="self-start">
        {t('instance.save')}
      </Button>
    </form>
  );
}
